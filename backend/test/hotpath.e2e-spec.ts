import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from 'redis';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HotpathRedis } from '../src/common/hotpath/hotpath-redis';
import { HotpathSnapshot } from '../src/common/hotpath/hotpath-snapshot';
import { configureApiVersioning } from '../src/configure-api';
import { IdentityRepository } from '../src/modules/identity/infrastructure/identity.repository';
import { REGISTRATION_LEGAL_ACCEPTANCE } from './helpers/legal-acceptance';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
import { memberFixture } from './support/member-fixture';
import { registerVerifiedOwner } from './support/verified-owner-fixture';

const redisContainer = process.env.ORBIT_HOTPATH_E2E_REDIS;
const suite = redisContainer ? describe : describe.skip;
jest.setTimeout(120_000);

function testRedis() {
  return createClient({
    socket: { host: '127.0.0.1', port: Number(process.env.REDIS_HOTPATH_PORT) },
    password: process.env.REDIS_HOTPATH_PASSWORD,
  });
}

suite('Redis hotpath and PostgreSQL authority', () => {
  const apps: INestApplication<App>[] = [];
  let redis: ReturnType<typeof testRedis>;
  const admin = adminPrisma();
  const http = (instance = 0) => request(apps[instance]!.getHttpServer());

  async function owner(documentNumber: string) {
    const email = `hotpath-${randomUUID()}@example.test`;
    const response = await registerVerifiedOwner(apps[0]!, {
      ...REGISTRATION_LEGAL_ACCEPTANCE,
      email,
      password: 'Synthetic#Only@2026',
      firstName: 'Orbit',
      lastName: 'Hotpath',
      organizationName: `Tenant ${documentNumber}`,
      legalName: `Tenant ${documentNumber} LTDA`,
      documentType: 'CNPJ',
      documentNumber,
      city: 'Recife',
      street: 'Rua da Aurora',
      stateCode: 'PE',
    });
    const token = (response.body as { data: { accessToken: string } }).data
      .accessToken;
    const user = await admin.user.findUniqueOrThrow({
      where: { normalizedEmail: email },
      select: { id: true, ownedOrganizations: { select: { id: true } } },
    });
    return { id: user.id, token, org: user.ownedOrganizations[0]!.id };
  }

  let a: Awaited<ReturnType<typeof owner>>;
  let b: Awaited<ReturnType<typeof owner>>;
  let customer: string;
  const org = (token: string, instance = 0) =>
    http(instance)
      .get('/api/v1/organizations/current')
      .set('Authorization', `Bearer ${token}`);
  const create = (key: string, title: string, instance = 0) =>
    http(instance)
      .post('/api/v1/quotes')
      .set('Authorization', `Bearer ${a.token}`)
      .set('Idempotency-Key', key)
      .send({ customerId: customer, title });

  beforeAll(async () => {
    if (
      !/^orbit-hotpath-e2e-[a-f0-9]+$/.test(redisContainer ?? '') ||
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_')
    )
      throw new Error('Disposable runner required');
    process.env.REDIS_HOTPATH_ENABLED = 'true';
    redis = testRedis();
    redis.on('error', () => undefined);
    await redis.connect();
    for (let index = 0; index < 2; index++) {
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
    for (const app of apps) {
      for (let i = 0; i < 50 && !app.get(HotpathRedis).available; i++)
        await delay(100);
      expect(app.get(HotpathRedis).available).toBe(true);
    }
    a = await owner('11222333000181');
    b = await owner('12345678000195');
    const row = await http()
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ type: 'INDIVIDUAL', legalName: 'Cliente de teste' })
      .expect(201);
    customer = (row.body as { data: { id: string } }).data.id;
  });

  afterAll(async () => {
    if (redis?.isOpen) redis.destroy();
    for (const app of apps) await app.close();
    delete process.env.REDIS_HOTPATH_ENABLED;
    await disconnectAdminPrisma();
  });

  it('shares the access snapshot, keeps tenants isolated, and checks suspension and revocation immediately', async () => {
    await org(a.token).expect(200);
    await org(b.token).expect(200);
    const session = await admin.session.findFirstOrThrow({
      where: { userId: a.id, revokedAt: null },
    });
    const fence = await apps[0]!.get(HotpathSnapshot).fence(session.id, a.id);
    expect(fence).toMatchObject({ organizationId: a.org, cacheable: true });
    expect(
      await redis.get(
        `orbit:v1:org:${a.org}:user:${a.id}:access:${fence?.accessVersion}`,
      ),
    ).not.toBeNull();
    const identity = jest.spyOn(apps[1]!.get(IdentityRepository), 'findById');
    const reply = await org(a.token, 1).expect(200);
    expect((reply.body as { data: { id: string } }).data.id).toBe(a.org);
    expect(identity).not.toHaveBeenCalled();
    expect(reply.headers['cache-control']).toMatch(/private.*no-store/);
    identity.mockRestore();
    await admin.organization.update({
      where: { id: b.org },
      data: { status: 'SUSPENDED' },
    });
    await http(1)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${b.token}`)
      .expect(403);
    await org(a.token, 1).expect(200);
    await admin.session.updateMany({
      where: { userId: b.id },
      data: { revokedAt: new Date() },
    });
    await org(b.token, 1).expect(401);
  });

  it('replays across replicas, rejects a mutated body, and recovers after Redis eviction', async () => {
    const key = randomUUID();
    const responses = await Promise.all([
      create(key, 'Idempotente'),
      create(key, 'Idempotente', 1),
    ]);
    expect(responses.some((res) => res.status === 201)).toBe(true);
    expect(
      responses.every((res) => res.status === 201 || res.status === 409),
    ).toBe(true);
    const initial = responses.find((res) => res.status === 201)!;
    const replay = await create(key, 'Idempotente', 1).expect(201);
    expect((replay.body as { data: unknown }).data).toEqual(
      (initial.body as { data: unknown }).data,
    );
    await create(key, 'Outro orçamento').expect(409);
    await redis.flushDb();
    const durable = await create(key, 'Idempotente', 1).expect(201);
    expect((durable.body as { data: unknown }).data).toEqual(
      (initial.body as { data: unknown }).data,
    );
    expect(
      await admin.quote.count({
        where: { organizationId: a.org, title: 'Idempotente' },
      }),
    ).toBe(1);
  });

  it('invalidates a warmed role grant without waiting for expiry', async () => {
    const unit = await admin.businessUnit.findFirstOrThrow({
      where: { organizationId: a.org },
    });
    const password = 'Synthetic#Only@2026';
    const member = await memberFixture(admin, {
      organizationId: a.org,
      businessUnitIds: [unit.id],
      permissions: ['quotes.read'],
      password,
    });
    const login = await http()
      .post('/api/v1/identity/login')
      .send({ email: member.email, password, client: 'WEB' })
      .expect(200);
    const { accessToken } = (login.body as { data: { accessToken: string } })
      .data;
    const quotes = (instance: number) =>
      http(instance)
        .get('/api/v1/quotes')
        .set('Authorization', `Bearer ${accessToken}`);
    await quotes(0).expect(200);
    await quotes(1).expect(200);
    await admin.role.update({
      where: { id: member.roleId },
      data: { permissions: [] },
    });
    await quotes(1).expect(403);
  });

  it('honors a billing boundary before a warmed plan snapshot could expire', async () => {
    const subscription = await admin.organizationSubscription.findFirstOrThrow({
      where: { organizationId: a.org, endedAt: null },
    });
    const deadline = new Date(Date.now() + 2_000);
    await admin.organizationSubscription.update({
      where: { id: subscription.id },
      data: { currentPeriodEnd: deadline, cancelAtPeriodEnd: true },
    });
    try {
      await create(randomUUID(), 'Antes do vencimento').expect(201);
      await delay(Math.max(0, deadline.getTime() - Date.now()) + 50);
      const expired = await create(
        randomUUID(),
        'Depois do vencimento',
        1,
      ).expect(402);
      expect((expired.body as { error: { code: string } }).error.code).toBe(
        'SUBSCRIPTION_EXPIRED',
      );
    } finally {
      await admin.organizationSubscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        },
      });
    }
  });

  it('replays a financial confirmation with the original response and ledger entry', async () => {
    const auth = (req: request.Test) =>
      req.set('Authorization', `Bearer ${a.token}`);
    const submitted = await auth(http().post('/api/v1/financial/entries'))
      .set('Idempotency-Key', randomUUID())
      .send({
        type: 'EXPENSE',
        amount: 250.4,
        description: 'Teste financeiro',
        competenceDate: '2026-08-05',
      })
      .expect(201);
    const { id } = (submitted.body as { data: { id: string } }).data;
    const key = randomUUID();
    const confirm = (replica: number) =>
      auth(http(replica).post(`/api/v1/financial/entries/${id}/confirm`))
        .set('Idempotency-Key', key)
        .send({});
    const initial = await confirm(0).expect(201);
    const replay = await confirm(1).expect(201);
    expect((replay.body as { data: unknown }).data).toEqual(
      (initial.body as { data: unknown }).data,
    );
    expect(
      await admin.financialEntry.count({
        where: {
          organizationId: a.org,
          description: 'Teste financeiro',
          status: 'CONFIRMED',
        },
      }),
    ).toBe(1);
  });

  it('uses the same strict rate budget across API processes', async () => {
    const token = 'Z'.repeat(64);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        http(index % 2)
          .post(`/api/v1/public/quotes/proposals/${token}/response`)
          .send({}),
      ),
    );
    const refused = results.filter((res) => res.status === 429);
    expect(refused).toHaveLength(2);
    expect(Number(refused[0]!.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('falls back on Redis command timeout and recovers after the circuit cooldown', async () => {
    execFileSync('docker', ['pause', redisContainer!], { stdio: 'ignore' });
    try {
      await org(a.token).expect(200);
      expect(apps[0]!.get(HotpathRedis).available).toBe(false);
      const health = await http().get('/api/v1/health/ready').expect(200);
      expect(health.body).toMatchObject({
        data: {
          status: 'degraded',
          checks: { postgres: 'ok', jobs: 'ok', redis: 'degraded' },
        },
      });
      await create(randomUUID(), 'Durante timeout').expect(201);
    } finally {
      execFileSync('docker', ['unpause', redisContainer!], { stdio: 'ignore' });
    }
    await delay(5_200);
    await expect(apps[0]!.get(HotpathRedis).command(['PING'])).resolves.toBe(
      'PONG',
    );
    const health = await http().get('/api/v1/health/ready').expect(200);
    expect(health.body).toMatchObject({
      data: { status: 'ok', checks: { redis: 'ok' } },
    });
  });

  it('continues to authenticate and apply the durable policy after Redis stops', async () => {
    const key = randomUUID();
    const initial = await create(key, 'Durante queda').expect(201);
    execFileSync('docker', ['stop', '--timeout', '2', redisContainer!], {
      stdio: 'ignore',
    });
    await org(a.token, 1).expect(200);
    const replay = await create(key, 'Durante queda', 1).expect(201);
    expect((replay.body as { data: unknown }).data).toEqual(
      (initial.body as { data: unknown }).data,
    );
    const response = await http(1)
      .post('/api/v1/identity/password/forgot')
      .send({ email: 'missing-hotpath@example.test' })
      .expect(202);
    expect(response.headers['cache-control']).toContain('no-store');
  });
});
