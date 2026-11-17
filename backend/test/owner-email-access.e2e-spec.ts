import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID, randomInt } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { CRYPTO_PROVIDER, HASH_PROVIDER } from '../src/providers';
import type { ICryptoProvider, IHashProvider } from '../src/contracts';
import { IdentityRepository } from '../src/modules/identity/infrastructure/identity.repository';
import { IdentityTokenService } from '../src/modules/identity/application/token.service';
import { toAuthenticatedIdentity } from '../src/modules/identity/application/authentication.service';
import { generateUuidV7 } from '../src/utils';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
const password = 'Orbit#Verified@2026';
const data = <T>(r: request.Response) => (r.body as { data: T }).data;
const error = (r: request.Response) =>
  (r.body as { error: { code: string; message: string } }).error;
function signup() {
  const digits = Array.from({ length: 9 }, () => randomInt(10));
  for (let len = 9; len <= 10; len++) {
    const value =
      (digits.reduce((sum, n, i) => sum + n * (len + 1 - i), 0) * 10) % 11;
    digits.push(value === 10 ? 0 : value);
  }
  const suffix = randomUUID();
  return {
    ...REGISTRATION_LEGAL_ACCEPTANCE,
    email: `pending.${suffix}@example.test`,
    password,
    firstName: 'Owner',
    lastName: 'Pendente',
    organizationName: `Email Gate ${suffix}`,
    legalName: 'Organização de teste',
    documentType: 'CPF',
    documentNumber: digits.join(''),
    city: 'Paulista',
    street: 'Rua de teste',
    stateCode: 'PE',
    planKey: 'ESSENTIAL',
    client: 'WEB',
  };
}
describe('First owner must prove email ownership before any portal access', () => {
  const admin = adminPrisma();
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error('Disposable database required');
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });
  async function emailToken(email: string) {
    const user = await admin.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
    });
    const mail = await admin.identityEmailDelivery.findFirstOrThrow({
      where: { userId: user.id, purpose: 'EMAIL_VERIFICATION' },
      orderBy: { createdAt: 'desc' },
    });
    return {
      user,
      token: (
        JSON.parse(
          app
            .get<ICryptoProvider>(CRYPTO_PROVIDER)
            .decrypt(mail.encryptedPayload!),
        ) as { token: string }
      ).token,
    };
  }
  async function forgedSession(userId: string, inGrace = false) {
    const service = app.get(IdentityTokenService),
      user = await app.get(IdentityRepository).findById(userId);
    const identity = toAuthenticatedIdentity(user!, generateUuidV7());
    const pair = await service.issue(identity);
    const previous = service.generateOpaqueToken();
    await admin.session.create({
      data: {
        id: identity.sessionId,
        userId,
        organizationId: identity.organizationId,
        businessUnitId: identity.businessUnitId,
        client: 'WEB',
        refreshTokenHash: pair.refreshTokenHash,
        expiresAt: pair.expiresAt,
        ...(inGrace
          ? {
              previousRefreshTokenHash: service.hashOpaqueToken(previous),
              rotationGraceUntil: new Date(Date.now() + 30000),
              rotationResponse: app
                .get<ICryptoProvider>(CRYPTO_PROVIDER)
                .encrypt(
                  JSON.stringify({
                    accessToken: pair.accessToken,
                    refreshToken: pair.refreshToken,
                    tokenType: 'Bearer',
                    expiresIn: pair.expiresIn,
                  }),
                ),
            }
          : {}),
      },
    });
    return { ...pair, id: identity.sessionId, previous };
  }
  it('keeps signup pending, persists optional address and blocks login/API/refresh until explicit confirmation', async () => {
    const input = { ...signup(), number: ' 42A ', complement: ' Sala 6 ' };
    const registered = await http()
      .post('/api/v1/identity/register')
      .send(input)
      .expect(201);
    expect(data(registered)).toEqual({
      status: 'EMAIL_VERIFICATION_REQUIRED',
      email: input.email,
    });
    const { user, token } = await emailToken(input.email);
    expect(await admin.session.count({ where: { userId: user.id } })).toBe(0);
    const org = await admin.organization.findFirstOrThrow({
      where: { ownerUserId: user.id },
    });
    expect(
      await admin.businessUnit.findFirst({
        where: { organizationId: org.id, isPrimary: true },
      }),
    ).toMatchObject({ number: '42A', complement: 'Sala 6' });
    for (const client of ['WEB', 'MOBILE', 'API']) {
      const blocked = await http()
        .post('/api/v1/identity/login')
        .send({ email: input.email, password, client })
        .expect(401);
      expect(error(blocked).code).toBe('EMAIL_VERIFICATION_REQUIRED');
      expect(error(blocked).message).toContain('Confirme seu e-mail');
    }
    const invalid = await http()
      .post('/api/v1/identity/login')
      .send({ email: input.email, password: 'Password#Wrong2026' })
      .expect(401);
    expect(error(invalid).code).toBe('INVALID_CREDENTIALS');
    const access = await forgedSession(user.id);
    await http()
      .get('/api/v1/identity/me')
      .set('Authorization', `Bearer ${access.accessToken}`)
      .expect(401);
    expect(
      (await admin.session.findUniqueOrThrow({ where: { id: access.id } }))
        .revokedAt,
    ).not.toBeNull();
    for (const grace of [false, true]) {
      const refresh = await forgedSession(user.id, grace);
      const r = await http()
        .post('/api/v1/identity/refresh')
        .send({ refreshToken: grace ? refresh.previous : refresh.refreshToken })
        .expect(401);
      expect(error(r).code).toBe('EMAIL_VERIFICATION_REQUIRED');
    }
    await http()
      .post('/api/v1/identity/email/verify')
      .send({ token: 'Z'.repeat(64) })
      .expect(400);
    await http()
      .post('/api/v1/identity/email/verify')
      .send({ token })
      .expect(204);
    await http()
      .post('/api/v1/identity/email/verify')
      .send({ token })
      .expect(400);
    const logged = await http()
      .post('/api/v1/identity/login')
      .send({ email: input.email, password, client: 'WEB' })
      .expect(200);
    const pair = data<{ accessToken: string; refreshToken: string }>(logged);
    await http()
      .get('/api/v1/identity/me')
      .set('Authorization', `Bearer ${pair.accessToken}`)
      .expect(200);
    await http()
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: pair.refreshToken })
      .expect(200);
    // Virtual-domain team accounts remain independent from the owner-only email policy.
    const role = await admin.role.findFirstOrThrow({
        where: { organizationId: org.id, key: 'FIELD_TECHNICIAN' },
      }),
      unit = await admin.businessUnit.findFirstOrThrow({
        where: { organizationId: org.id, isPrimary: true },
      });
    const email = `technician.${randomUUID()}@organization.orbit.local`;
    await admin.user.create({
      data: {
        email,
        normalizedEmail: email,
        displayName: 'Técnico',
        firstName: 'Técnico',
        lastName: 'Teste',
        status: 'ACTIVE',
        credential: {
          create: {
            passwordHash: await app
              .get<IHashProvider>(HASH_PROVIDER)
              .hash(password),
          },
        },
        organizationMemberships: {
          create: { organizationId: org.id, roleId: role.id },
        },
        businessUnitMemberships: {
          create: {
            organizationId: org.id,
            businessUnitId: unit.id,
            roleId: role.id,
          },
        },
      },
    });
    await http()
      .post('/api/v1/identity/login')
      .send({ email, password, client: 'MOBILE' })
      .expect(200);
  });
  it.each([{}, { number: '', complement: '' }])(
    'accepts optional address omitted or blank: %j',
    async (optional) => {
      const input = { ...signup(), ...optional };
      await http().post('/api/v1/identity/register').send(input).expect(201);
      const user = await admin.user.findUniqueOrThrow({
          where: { normalizedEmail: input.email },
        }),
        org = await admin.organization.findFirstOrThrow({
          where: { ownerUserId: user.id },
        });
      expect(
        await admin.businessUnit.findFirst({
          where: { organizationId: org.id, isPrimary: true },
        }),
      ).toMatchObject({ number: null, complement: null });
    },
  );
  it('rejects malformed email before persisting a user or sending mail', async () => {
    const input = { ...signup(), email: 'invalid-address' };
    await http().post('/api/v1/identity/register').send(input).expect(400);
    expect(
      await admin.user.count({ where: { normalizedEmail: input.email } }),
    ).toBe(0);
  });
});
