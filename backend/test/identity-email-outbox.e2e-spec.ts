import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { randomUUID, randomInt } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { PrismaService } from '../src/database';
import {
  IdentityEmailOutbox,
  IDENTITY_EMAIL_LEASE_MS,
} from '../src/modules/identity/infrastructure/identity-email.outbox';
import { IdentityEmailWorker } from '../src/modules/identity/infrastructure/identity-email.worker';
import {
  IDENTITY_TOKEN_DELIVERY,
  type IIdentityTokenDelivery,
} from '../src/modules/identity/domain/identity.types';
import { CRYPTO_PROVIDER } from '../src/providers';
import type { ICryptoProvider } from '../src/contracts';
import { HashHelper } from '../src/helpers/foundation.helpers';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';

jest.setTimeout(120000);
const password = 'Orbit#Email@2026';
const data = <T>(r: request.Response) => (r.body as { data: T }).data;
function signup() {
  const digits = Array.from({ length: 9 }, () => randomInt(10));
  for (let len = 9; len <= 10; len++) {
    const mod =
      (digits.reduce((s, n, i) => s + n * (len + 1 - i), 0) * 10) % 11;
    digits.push(mod === 10 ? 0 : mod);
  }
  return {
    ...REGISTRATION_LEGAL_ACCEPTANCE,
    email: `fixture.email.${randomUUID()}@orbit.local`,
    firstName: 'Owner',
    lastName: 'Email',
    password,
    organizationName: `Email ${randomUUID()}`,
    legalName: 'Email de teste',
    documentType: 'CPF',
    documentNumber: digits.join(''),
    city: 'Recife',
    street: 'Rua de teste',
    stateCode: 'PE',
    planKey: 'ESSENTIAL',
  };
}

describe('PR-07: outbox SES com HTTP, reinício e RLS real', () => {
  const apps: INestApplication<App>[] = [];
  const admin = adminPrisma();
  const sender = {
    deliver: jest
      .fn<
        ReturnType<IIdentityTokenDelivery['deliver']>,
        Parameters<IIdentityTokenDelivery['deliver']>
      >()
      .mockResolvedValue({
        status: 'SENT',
        provider: 'ses',
        providerMessageId: 'synthetic-ses-id',
      }),
  };
  let principal: {
    email: string;
    id: string;
    token: string;
    org: string;
    role: string;
    unit: string;
  };
  let crypto: ICryptoProvider;
  const http = (replica = 0) => request(apps[replica]!.getHttpServer());
  const auth = (t: request.Test) =>
    t.set('Authorization', `Bearer ${principal.token}`);
  const worker = (replica = 0) => apps[replica]!.get(IdentityEmailWorker);
  const outbox = (replica = 0) => apps[replica]!.get(IdentityEmailOutbox);
  const payload = (row: { encryptedPayload: string | null }) =>
    JSON.parse(crypto.decrypt(row.encryptedPayload!)) as {
      token: string;
      recipient: string;
    };
  const row = () =>
    admin.identityEmailDelivery.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
  const forgot = (email = principal.email) =>
    http().post('/api/v1/identity/password/forgot').send({ email });
  beforeAll(async () => {
    const [db] = await admin.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    if (
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_') ||
      db?.name !== process.env.ORBIT_E2E_DATABASE
    )
      throw new Error('Disposable runner required');
    process.env.JOBS_WORKER_ENABLED = 'false';
    for (let n = 0; n < 2; n++) {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(IDENTITY_TOKEN_DELIVERY)
        .useValue(sender)
        .compile();
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
    crypto = apps[0]!.get<ICryptoProvider>(CRYPTO_PROVIDER);
    const input = signup();
    const registered = await http()
      .post('/api/v1/identity/register')
      .send(input)
      .expect(201);
    const user = await admin.user.findUniqueOrThrow({
      where: { normalizedEmail: input.email },
    });
    const org = await admin.organization.findFirstOrThrow({
      where: { ownerUserId: user.id },
    });
    const role = await admin.role.findFirstOrThrow({
      where: { organizationId: org.id, key: 'FIELD_TECHNICIAN' },
    });
    const unit = await admin.businessUnit.findFirstOrThrow({
      where: { organizationId: org.id },
    });
    principal = {
      email: input.email,
      id: user.id,
      token: data<{ accessToken: string }>(registered).accessToken,
      org: org.id,
      role: role.id,
      unit: unit.id,
    };
  });
  beforeEach(async () => {
    await admin.identityEmailDelivery.deleteMany();
    await admin.authRateLimitBucket.deleteMany();
    sender.deliver.mockClear();
    sender.deliver.mockResolvedValue({
      status: 'SENT',
      provider: 'ses',
      providerMessageId: 'synthetic-ses-id',
    });
  });
  afterAll(async () => {
    for (const app of apps) await app.close();
    await disconnectAdminPrisma();
  });

  it('cadastro e boas-vindas são atômicos; uma falha na fila desfaz a conta inteira', async () => {
    const input = signup();
    const fail = jest
      .spyOn(outbox(), 'enqueueIn')
      .mockRejectedValueOnce(new Error('Synthetic outbox failure'));
    try {
      await http().post('/api/v1/identity/register').send(input).expect(500);
    } finally {
      fail.mockRestore();
    }
    expect(
      await admin.user.count({ where: { normalizedEmail: input.email } }),
    ).toBe(0);
    expect(await admin.identityEmailDelivery.count()).toBe(0);
    await http().post('/api/v1/identity/register').send(input).expect(201);
    const pending = await row();
    const secret = payload(pending);
    expect(pending.purpose).toBe('EMAIL_VERIFICATION');
    expect(pending.encryptedPayload).not.toContain(secret.token);
    expect(pending.encryptedPayload).not.toContain(input.email);
    expect(
      (
        await admin.emailVerificationToken.findUniqueOrThrow({
          where: { userId: pending.userId! },
        })
      ).tokenHash,
    ).toBe(HashHelper.sha256(secret.token));
    expect(sender.deliver).not.toHaveBeenCalled();
    await worker(1).tick();
    expect((await row()).status).toBe('ACCEPTED_BY_PROVIDER');
    expect((await row()).encryptedPayload).toBeNull();
    expect(
      await admin.user.count({ where: { normalizedEmail: input.email } }),
    ).toBe(1);
  });
  it('reinício/reivindicação concorrente recupera a mensagem sem criar conta ou token novo', async () => {
    await forgot().expect(202);
    const first = await row();
    const original = payload(first);
    const claimed = await outbox().claim();
    expect(claimed?.id).toBe(first.id);
    await admin.identityEmailDelivery.update({
      where: { id: first.id },
      data: { lockedAt: new Date(Date.now() - IDENTITY_EMAIL_LEASE_MS - 1000) },
    });
    await Promise.all([worker().tick(), worker(1).tick()]);
    expect(sender.deliver).toHaveBeenCalledTimes(1);
    expect(sender.deliver).toHaveBeenCalledWith(
      'PASSWORD_RESET',
      principal.email,
      original.token,
    );
    const done = await row();
    expect(done.status).toBe('ACCEPTED_BY_PROVIDER');
    expect(done.attempts).toBe(2);
    expect(done.encryptedPayload).toBeNull();
    expect(
      (await outbox().finish(claimed!, 'FAILED', 'STALE_REPLICA')).count,
    ).toBe(0);
    await worker().tick();
    expect(sender.deliver).toHaveBeenCalledTimes(1);
  });
  it('a mesma intenção é idempotente mesmo quando gravada novamente', async () => {
    await forgot().expect(202);
    const queued = await row();
    const secret = payload(queued);
    const runtime = apps[0]!.get(PrismaService);
    await runtime.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.user_id', ${principal.id}, true)`;
      await outbox().enqueueIn(tx, {
        purpose: 'PASSWORD_RESET',
        recipient: secret.recipient,
        token: secret.token,
        userId: principal.id,
        expiresAt: queued.expiresAt,
      });
    });
    expect(await admin.identityEmailDelivery.count()).toBe(1);
    await Promise.all([worker().tick(), worker(1).tick()]);
    expect(sender.deliver).toHaveBeenCalledTimes(1);
  });
  it('falha temporária persiste backoff; réplica posterior reaproveita o token', async () => {
    await forgot().expect(202);
    const queued = await row();
    const original = payload(queued);
    sender.deliver.mockResolvedValueOnce({
      status: 'FAILED',
      provider: 'ses',
      code: 'SES_THROTTLED',
      retryable: true,
    });
    await worker().tick();
    const retry = await row();
    expect(retry.status).toBe('PENDING');
    expect(retry.availableAt.getTime()).toBeGreaterThan(Date.now());
    await admin.identityEmailDelivery.update({
      where: { id: queued.id },
      data: { availableAt: new Date(0) },
    });
    await worker(1).tick();
    expect((await row()).status).toBe('ACCEPTED_BY_PROVIDER');
    expect(sender.deliver.mock.calls.map((c) => c[2])).toEqual([
      original.token,
      original.token,
    ]);
  });
  it('falha permanente encerra e elimina o segredo recuperável', async () => {
    await forgot().expect(202);
    sender.deliver.mockResolvedValueOnce({
      status: 'FAILED',
      provider: 'ses',
      code: 'SES_MESSAGE_REJECTED',
      retryable: false,
    });
    await worker().tick();
    expect((await row()).status).toBe('FAILED');
    expect((await row()).encryptedPayload).toBeNull();
    await worker(1).tick();
    expect(sender.deliver).toHaveBeenCalledTimes(1);
  });
  it('recuperação mantém resposta neutra e rollback não destrói o token anterior', async () => {
    await forgot().expect(202);
    const previous = await row();
    const fail = jest
      .spyOn(outbox(), 'enqueueIn')
      .mockRejectedValueOnce(new Error('SECRET_CANARY'));
    let existing: request.Response;
    try {
      existing = await forgot().expect(202);
    } finally {
      fail.mockRestore();
    }
    const absent = await forgot(`missing.${randomUUID()}@orbit.local`).expect(
      202,
    );
    expect(data<unknown>(existing!)).toEqual(data<unknown>(absent));
    expect(await admin.identityEmailDelivery.count()).toBe(1);
    expect(
      (
        await admin.passwordResetToken.findFirstOrThrow({
          where: { userId: principal.id },
        })
      ).tokenHash,
    ).toBe(previous.tokenHash);
  });
  it.each(['expired', 'used', 'replaced', 'disabled'] as const)(
    'não envia recuperação %s',
    async (reason) => {
      await forgot().expect(202);
      const queued = await row();
      const original = payload(queued);
      if (reason === 'expired')
        await admin.passwordResetToken.updateMany({
          where: { userId: principal.id },
          data: { expiresAt: new Date(0) },
        });
      if (reason === 'used')
        await http()
          .post('/api/v1/identity/password/reset')
          .send({ token: original.token, password })
          .expect(204);
      if (reason === 'replaced') {
        await forgot().expect(202);
        await admin.identityEmailDelivery.deleteMany({
          where: { id: { not: queued.id } },
        });
      }
      if (reason === 'disabled')
        await admin.user.update({
          where: { id: principal.id },
          data: { status: 'INACTIVE' },
        });
      try {
        await worker().tick();
        expect((await row()).status).toBe('SKIPPED');
        expect(sender.deliver).not.toHaveBeenCalled();
      } finally {
        if (reason === 'used') {
          const login = await http()
            .post('/api/v1/identity/login')
            .send({ email: principal.email, password, client: 'WEB' })
            .expect(200);
          principal.token = data<{ accessToken: string }>(login).accessToken;
        }
        if (reason === 'disabled')
          await admin.user.update({
            where: { id: principal.id },
            data: { status: 'ACTIVE' },
          });
      }
    },
  );
  it('convite reenviado invalida entrega anterior; revogar impede retry', async () => {
    const created = await auth(http().post('/api/v1/identity/invitations'))
      .send({
        email: `inv.${randomUUID()}@orbit.local`,
        roleId: principal.role,
      })
      .expect(201);
    const id = data<{ id: string }>(created).id;
    const first = await row();
    await auth(http().post(`/api/v1/identity/invitations/${id}/resend`)).expect(
      201,
    );
    await worker().tick();
    expect(
      (
        await admin.identityEmailDelivery.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).status,
    ).toBe('SKIPPED');
    await auth(http().delete(`/api/v1/identity/invitations/${id}`)).expect(204);
    await worker(1).tick();
    expect(sender.deliver).not.toHaveBeenCalled();
    expect((await row()).status).toBe('SKIPPED');
  });
  it('cadastro de equipe e link de senha enfileiram sem afirmar entrega', async () => {
    const email = `fixture.member.email.${randomUUID()}@orbit.local`;
    const member = await auth(
      http().post('/api/v1/organizations/current/team/members'),
    )
      .send({
        email,
        firstName: 'Técnico',
        lastName: 'Email',
        roleId: principal.role,
        businessUnitIds: [principal.unit],
      })
      .expect(201);
    const id = data<{ member: { userId: string } }>(member).member.userId;
    const welcome = await row();
    expect(welcome.userId).toBe(id);
    expect(welcome.purpose).toBe('EMAIL_VERIFICATION');
    expect(sender.deliver).not.toHaveBeenCalled();
    await worker().tick();
    const link = await auth(
      http().post(
        `/api/v1/organizations/current/team/members/${id}/password-link`,
      ),
    ).expect(201);
    expect(
      data<{ emailSent: boolean; emailQueued: boolean }>(link),
    ).toMatchObject({ emailSent: false, emailQueued: true });
    const pending = await row();
    expect(pending.userId).toBe(id);
    expect(pending.purpose).toBe('PASSWORD_RESET');
    expect(pending.status).toBe('PENDING');
    await worker().tick();
    expect(sender.deliver).toHaveBeenCalledWith(
      'PASSWORD_RESET',
      email,
      payload(pending).token,
    );
  });
  it('RLS não expõe a fila a requisições nem usa privilégio de worker em tabelas de tenant', async () => {
    await forgot().expect(202);
    const runtime = apps[0]!.get(PrismaService);
    expect(await runtime.identityEmailDelivery.findMany()).toEqual([]);
    await runtime.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.identity_email_worker','true',true)`;
      expect(await tx.identityEmailDelivery.count()).toBe(1);
      expect(
        await tx.organization.findMany({ where: { id: principal.org } }),
      ).toEqual([]);
    });
    const foreign = await admin.user.create({
      data: {
        email: `fixture.foreign.${randomUUID()}@orbit.local`,
        normalizedEmail: `fixture.other.${randomUUID()}@orbit.local`,
        displayName: 'Foreign',
        firstName: 'Foreign',
        lastName: 'User',
      },
    });
    await expect(
      runtime.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id',${principal.id},true)`;
        await outbox().enqueueIn(tx, {
          purpose: 'PASSWORD_RESET',
          recipient: 'foreign@orbit.local',
          token: 'synthetic-private-token',
          userId: foreign.id,
          expiresAt: new Date(Date.now() + 60000),
        });
      }),
    ).rejects.toThrow();
  });
});
