import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { IdentityRepository } from '../src/modules/identity/infrastructure/identity.repository';
import { IdentityTokenService } from '../src/modules/identity/application/token.service';
import { MfaService } from '../src/modules/identity/application/mfa.service';
import { generateTotpToken } from '../src/utils/totp';
import { CRYPTO_PROVIDER, HASH_PROVIDER } from '../src/providers';
import type { ICryptoProvider, IHashProvider } from '../src/contracts';
import type { TokenPair } from '../src/modules/identity/domain/identity.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(120_000);
const PASSWORD = 'Orbit#Concurrency@2026';
const data = <T>(response: request.Response) =>
  (response.body as { data: T }).data;

describe('PR-04: identidade concorrente entre duas instâncias', () => {
  const apps: INestApplication<App>[] = [];
  const admin = adminPrisma();
  let roleId: string;
  let hashes: IHashProvider;
  let crypto: ICryptoProvider;
  const http = (instance = 0) => request(apps[instance]!.getHttpServer());
  async function account() {
    const email = `concurrency.${randomUUID()}@orbit.local`;
    return admin.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Teste',
        lastName: 'Concorrência',
        displayName: 'Teste Concorrência',
        status: 'ACTIVE',
        credential: { create: { passwordHash: await hashes.hash(PASSWORD) } },
        platformRoleAssignments: { create: { roleId } },
      },
      include: { credential: true },
    });
  }
  async function login(email: string, instance = 0) {
    const response = await http(instance)
      .post('/api/v1/identity/login')
      .send({ email, password: PASSWORD, client: 'MOBILE' })
      .expect(200);
    return data<TokenPair>(response);
  }
  const refresh = (token: string, instance = 0) =>
    http(instance)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: token });
  const me = (token: string, instance = 0) =>
    http(instance)
      .get('/api/v1/identity/me')
      .set('Authorization', `Bearer ${token}`);
  async function sessionId(pair: TokenPair) {
    return (
      await apps[0]!
        .get(IdentityTokenService)
        .verifyAccessToken(pair.accessToken)
    ).sid;
  }
  beforeAll(async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    for (let instance = 0; instance < 2; instance++) {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const app = module.createNestApplication<INestApplication<App>>();
      apps.push(app);
      configureApiVersioning(app);
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.listen(0, '127.0.0.1');
    }
    hashes = apps[0]!.get<IHashProvider>(HASH_PROVIDER);
    crypto = apps[0]!.get<ICryptoProvider>(CRYPTO_PROVIDER);
    const role = await admin.role.create({
      data: {
        key: `CONCURRENCY_${randomUUID()}`,
        name: 'Acesso de teste',
        permissions: ['profile.read'],
        allowedSurfaces: ['WEB', 'MOBILE'],
      },
    });
    roleId = role.id;
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    await disconnectAdminPrisma();
  });

  it('o mesmo recovery code só autentica uma vez e códigos diferentes não ressuscitam', async () => {
    const user = await account();
    const codes = [
      'recovery-first-unique',
      'recovery-second-unique',
      'recovery-third-unique',
    ];
    const factor = await admin.mfaFactor.create({
      data: {
        userId: user.id,
        secret: crypto.encrypt('JBSWY3DPEHPK3PXP'),
        verifiedAt: new Date(),
        recoveryCodes: await Promise.all(
          codes.map((code) => hashes.hash(code)),
        ),
      },
    });
    // Both replicas intentionally receive the same stale snapshot. The real
    // hash provider and database decide which consumption actually succeeds.
    const results = await Promise.allSettled(
      apps.map((app) => app.get(MfaService).verifyFactor(factor, codes[0])),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: 'MFA_INVALID' });
    await Promise.all(
      apps.map((app, index) =>
        app.get(MfaService).verifyFactor(factor, codes[index + 1]),
      ),
    );
    expect(
      (await admin.mfaFactor.findUniqueOrThrow({ where: { id: factor.id } }))
        .recoveryCodes,
    ).toEqual([]);
    await expect(
      apps[0]!.get(MfaService).verifyFactor(factor, codes[1]),
    ).rejects.toMatchObject({ code: 'MFA_INVALID' });
  });

  it('código de recuperação emitido pelo cadastro passa pela validação HTTP e só entra uma vez', async () => {
    const user = await account();
    const signedIn = await login(user.email);
    const enrollment = data<{ factorId: string; secret: string }>(
      await http()
        .post('/api/v1/identity/me/mfa/enrollment')
        .set('Authorization', `Bearer ${signedIn.accessToken}`)
        .expect(201),
    );
    const enabled = data<{ recoveryCodes: string[] }>(
      await http()
        .post('/api/v1/identity/me/mfa/enable')
        .set('Authorization', `Bearer ${signedIn.accessToken}`)
        .send({
          factorId: enrollment.factorId,
          code: generateTotpToken(enrollment.secret),
        })
        .expect(201),
    );
    expect(enabled.recoveryCodes[0]).toHaveLength(16);
    const attempts = await Promise.all(
      apps.map((_, index) =>
        http(index).post('/api/v1/identity/login').send({
          email: user.email,
          password: PASSWORD,
          client: 'MOBILE',
          mfaCode: enabled.recoveryCodes[0],
        }),
      ),
    );
    expect(attempts.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(attempts.find((r) => r.status === 401)!.body).toMatchObject({
      error: { code: 'MFA_INVALID' },
    });
  });

  it('refresh paralelo devolve um único par canônico, inclusive ao usar o sucessor durante grace', async () => {
    const user = await account();
    const original = await login(user.email);
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        refresh(original.refreshToken, index % 2),
      ),
    );
    responses.forEach((response) => expect(response.status).toBe(200));
    const pairs = responses.map((response) => data<TokenPair>(response));
    expect(new Set(pairs.map((pair) => pair.refreshToken)).size).toBe(1);
    expect(new Set(pairs.map((pair) => pair.accessToken)).size).toBe(1);
    const pair = pairs[0]!;
    expect(pair.refreshToken).not.toBe(original.refreshToken);
    for (const token of [original.refreshToken, pair.refreshToken])
      expect(data<TokenPair>(await refresh(token, 1).expect(200))).toEqual(
        pair,
      );
    const id = await sessionId(pair);
    const persisted = await admin.session.findUniqueOrThrow({ where: { id } });
    expect(persisted.refreshTokenHash).toBe(
      apps[0]!.get(IdentityTokenService).hashOpaqueToken(pair.refreshToken),
    );
    expect(persisted.rotationResponse).not.toContain(pair.refreshToken);
    expect(persisted.rotationResponse).not.toContain(pair.accessToken);
    await me(pair.accessToken, 1).expect(200);
    const overview = await http()
      .get('/api/v1/identity/me/sessions')
      .set('Authorization', `Bearer ${pair.accessToken}`)
      .expect(200);
    expect(JSON.stringify(overview.body)).not.toContain(
      persisted.rotationResponse!,
    );
    // Expire only the synthetic window; no wall-clock sleeps in this test.
    await admin.session.update({
      where: { id },
      data: { rotationGraceUntil: new Date(Date.now() - 1000) },
    });
    const next = data<TokenPair>(
      await refresh(pair.refreshToken, 1).expect(200),
    );
    expect(next.refreshToken).not.toBe(pair.refreshToken);
  });

  it('replay do token anterior fora da janela revoga a sessão, sem estender grace', async () => {
    const user = await account();
    const original = await login(user.email);
    const pair = data<TokenPair>(
      await refresh(original.refreshToken).expect(200),
    );
    const id = await sessionId(pair);
    const before = await admin.session.findUniqueOrThrow({ where: { id } });
    await refresh(original.refreshToken, 1).expect(200);
    expect(
      (await admin.session.findUniqueOrThrow({ where: { id } }))
        .rotationGraceUntil,
    ).toEqual(before.rotationGraceUntil);
    await admin.session.update({
      where: { id },
      data: { rotationGraceUntil: new Date(Date.now() - 1000) },
    });
    await refresh(original.refreshToken, 1).expect(401);
    await refresh(pair.refreshToken).expect(401);
    await me(pair.accessToken).expect(401);
    const revoked = await admin.session.findUniqueOrThrow({ where: { id } });
    expect(revoked.revokedAt).not.toBeNull();
    expect(revoked.rotationResponse).toBeNull();
  });

  for (const action of [
    'logout',
    'password-reset',
    'revoke',
    'expire',
    'surface',
  ] as const) {
    it(`${action} continua efetivo durante a janela, nas duas réplicas`, async () => {
      const user = await account();
      const original = await login(user.email);
      const pair = data<TokenPair>(
        await refresh(original.refreshToken).expect(200),
      );
      const id = await sessionId(pair);
      const repository = apps[0]!.get(IdentityRepository);
      if (action === 'logout') {
        await http()
          .post('/api/v1/identity/logout')
          .set('Authorization', `Bearer ${pair.accessToken}`)
          .send({})
          .expect(204);
      } else if (action === 'password-reset') {
        const reset = await repository.createPasswordReset(
          user.id,
          'synthetic-reset-hash',
          new Date(Date.now() + 60_000),
        );
        await repository.consumePasswordReset(
          reset.id,
          user.id,
          await hashes.hash('Orbit#Changed@2026'),
        );
      } else if (action === 'revoke') {
        await repository.revokeUserSessions(user.id);
      } else if (action === 'expire') {
        await admin.session.update({
          where: { id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      } else {
        await admin.platformRoleAssignment.updateMany({
          where: { userId: user.id },
          data: { revokedAt: new Date() },
        });
      }
      const first = await refresh(original.refreshToken, 1);
      expect([401, 403]).toContain(first.status);
      await refresh(pair.refreshToken).expect(401);
      await me(pair.accessToken, 1).expect(401);
    });
  }

  it('falhas simultâneas de senha atingem o bloqueio sem perder incrementos', async () => {
    const user = await account();
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        http(index % 2)
          .post('/api/v1/identity/login')
          .send({
            email: user.email,
            password: 'senha-errada',
            client: 'MOBILE',
          }),
      ),
    );
    responses.forEach((response) => expect(response.status).toBe(401));
    const credential = await admin.credential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.failedAttempts).toBe(5);
    expect(credential.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    const locked = await http()
      .post('/api/v1/identity/login')
      .send({ email: user.email, password: PASSWORD, client: 'MOBILE' })
      .expect(401);
    expect(locked.body).toMatchObject({ error: { code: 'ACCOUNT_LOCKED' } });
    await admin.credential.update({
      where: { id: credential.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });
    await login(user.email);
  });

  it('logout concorrente à gravação da rotação nunca reativa a sessão', async () => {
    const user = await account();
    const original = await login(user.email);
    const id = await sessionId(original);
    const tokens = apps[0]!.get(IdentityTokenService);
    const claims = await tokens.verifyAccessToken(original.accessToken);
    const next = await tokens.issue({
      id: claims.sub,
      sessionId: claims.sid,
      organizationId: null,
      businessUnitId: null,
      businessUnitIds: [],
      roles: claims.roles,
      permissions: claims.permissions,
      allowedSurfaces: claims.allowedSurfaces,
      isOrganizationOwner: false,
    });
    await Promise.all([
      apps[0]!
        .get(IdentityRepository)
        .rotateSession(
          id,
          tokens.hashOpaqueToken(original.refreshToken),
          next.refreshTokenHash,
          next.expiresAt,
          crypto.encrypt(JSON.stringify(next)),
        ),
      apps[1]!.get(IdentityRepository).revokeSession(id),
    ]);
    const persisted = await admin.session.findUniqueOrThrow({ where: { id } });
    expect(persisted.revokedAt).not.toBeNull();
    expect(persisted.rotationResponse).toBeNull();
    await refresh(original.refreshToken).expect(401);
    await refresh(next.refreshToken, 1).expect(401);
  });

  it('uma verificação antiga não pode abrir sessão após troca de senha ou bloqueio', async () => {
    const user = await account();
    const repository = apps[0]!.get(IdentityRepository);
    const stale = await repository.findById(user.id);
    expect(stale?.credential).toBeTruthy();
    const issue = async () => {
      const tokens = apps[0]!.get(IdentityTokenService);
      const id = randomUUID();
      const pair = await tokens.issue({
        id: user.id as never,
        sessionId: id as never,
        organizationId: null,
        businessUnitId: null,
        businessUnitIds: [],
        roles: [],
        permissions: [],
        allowedSurfaces: ['MOBILE'],
        isOrganizationOwner: false,
      });
      return repository.completeLogin(
        {
          id,
          userId: user.id,
          client: 'MOBILE',
          refreshTokenHash: pair.refreshTokenHash,
          expiresAt: pair.expiresAt,
        },
        stale!.credential!.id,
        stale!.credential!.passwordHash,
      );
    };
    await admin.credential.update({
      where: { userId: user.id },
      data: { lockedUntil: new Date(Date.now() + 60_000) },
    });
    await expect(issue()).rejects.toMatchObject({ code: 'ACCOUNT_LOCKED' });
    await repository.changePassword(
      user.id,
      await hashes.hash('Orbit#NewPassword@2026'),
    );
    await expect(issue()).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    // A delayed failure against the old hash cannot change the new credential.
    await repository.updateFailedLogin(
      stale!.credential!.id,
      stale!.credential!.passwordHash,
    );
    expect(
      (await admin.credential.findUniqueOrThrow({ where: { userId: user.id } }))
        .failedAttempts,
    ).toBe(0);
    expect(
      await admin.session.count({
        where: { userId: user.id, revokedAt: null },
      }),
    ).toBe(0);
  });
});
