import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { PrismaService } from '../src/database';
import { HASH_PROVIDER } from '../src/providers';
import type { IHashProvider } from '../src/contracts';
import { IDENTITY_TOKEN_DELIVERY } from '../src/modules/identity/domain/identity.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(120_000);
describe('PR-05: limites e origem entre réplicas (PostgreSQL/RLS)', () => {
  const apps: INestApplication<App>[] = [];
  const admin = adminPrisma();
  const original = { ...process.env };
  const http = (instance = 0) => request(apps[instance]!.getHttpServer());
  const forgot = (
    email: string,
    instance = 0,
    headers: Record<string, string> = {},
  ) =>
    http(instance)
      .post('/api/v1/identity/password/forgot')
      .set(headers)
      .send({ email });
  beforeAll(async () => {
    const [database] = await admin.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    if (
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_') ||
      database?.name !== process.env.ORBIT_E2E_DATABASE
    )
      throw new Error('This suite requires the disposable integration runner');
    for (let index = 0; index < 2; index++) {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(IDENTITY_TOKEN_DELIVERY)
        .useValue({ deliver: () => Promise.resolve() })
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
  });
  beforeEach(async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '2';
    process.env.AUTH_RATE_LIMIT_ORIGIN_MAX = '20';
    process.env.AUTH_RATE_LIMIT_WINDOW_MS = '60000';
    await admin.authRateLimitBucket.deleteMany();
  });
  afterAll(async () => {
    process.env = original;
    for (const app of apps) await app.close();
    await disconnectAdminPrisma();
  });
  it('oito chamadas em duas instâncias compartilham exatamente duas admissões', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        forgot('shared@example.test', index % 2, {
          'x-orbit-client-ip': `192.0.2.${index + 1}`,
          'x-orbit-proxy-secret': process.env.TRUSTED_PROXY_SECRET!,
        }),
      ),
    );
    expect(results.filter((result) => result.status === 202)).toHaveLength(2);
    expect(results.filter((result) => result.status === 429)).toHaveLength(6);
    const blocked = results.find((result) => result.status === 429)!;
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    const body = blocked.body as {
      error: {
        code: string;
        message: string;
        details: { retryAfterSeconds: number };
      };
    };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(body).toMatchObject({
      error: {
        code: 'RATE_LIMITED',
        details: { retryAfterSeconds: body.error.details.retryAfterSeconds },
      },
    });
    expect(body.error.message).toMatch(/Aguarde|aguarde/);
  });
  it('contas existentes e inexistentes recebem a mesma política de recuperação', async () => {
    const known = 'known-rate-limit@example.test';
    await admin.user.create({
      data: {
        email: known,
        normalizedEmail: known,
        firstName: 'Teste',
        lastName: 'Limites',
        displayName: 'Teste Limites',
        status: 'ACTIVE',
        credential: {
          create: {
            passwordHash: await apps[0]!
              .get<IHashProvider>(HASH_PROVIDER)
              .hash('Synthetic#Only@2026'),
          },
        },
      },
    });
    for (const email of [known, 'unknown-rate-limit@example.test']) {
      await forgot(email).expect(202);
      await forgot(email, 1).expect(202);
      await forgot(email).expect(429);
    }
  });

  it('IPs forjados não mudam a origem; somente o proxy autenticado a substitui', async () => {
    process.env.AUTH_RATE_LIMIT_ORIGIN_MAX = '2';
    for (let index = 0; index < 3; index++) {
      const path =
        index === 2
          ? '/API/V1/IDENTITY/PASSWORD/FORGOT/'
          : '/api/v1/identity/password/forgot';
      await http(index % 2)
        .post(path)
        .set({
          'x-forwarded-for': `203.0.113.${index}`,
          'x-real-ip': `203.0.113.${index}`,
          forwarded: `for=203.0.113.${index}`,
          'cf-connecting-ip': `203.0.113.${index}`,
          'x-orbit-client-ip': `203.0.113.${index}`,
          'x-orbit-proxy-secret': 'forged',
        })
        .send({ email: `spoof${index}@example.test` })
        .expect(index < 2 ? 202 : 429);
    }
    await forgot('trusted@example.test', 1, {
      'x-orbit-client-ip': '203.0.113.100',
      'x-orbit-proxy-secret': process.env.TRUSTED_PROXY_SECRET!,
    }).expect(202);
  });
  it('contas diferentes não herdam o limite do processo BFF, e ações são independentes', async () => {
    for (const email of ['one@example.test', 'two@example.test']) {
      await forgot(email).expect(202);
      await forgot(email, 1).expect(202);
    }
    await forgot('ONE@example.test').expect(429);
    await forgot('three@example.test').expect(202);
    await http()
      .post('/api/v1/identity/login')
      .send({ email: 'one@example.test', password: 'Invalid#Password@2026' })
      .expect(401);
    const persisted = JSON.stringify(
      await admin.authRateLimitBucket.findMany(),
    );
    expect(persisted).not.toContain('@example.test');
    expect(persisted).not.toContain('127.0.0.1');
  });
  it('protege a rota real de criação de checkout antes de autenticar', async () => {
    process.env.AUTH_RATE_LIMIT_ORIGIN_MAX = '2';
    for (let index = 0; index < 3; index++) {
      await http(index % 2)
        .post('/api/v1/billing/checkout-session')
        .send({})
        .expect(index < 2 ? 401 : 429);
    }
  });
  it('recusar não prolonga a janela; após vencer, o orçamento volta sem perder a identidade', async () => {
    await forgot('expiry@example.test').expect(202);
    await forgot('expiry@example.test').expect(202);
    const before = await admin.authRateLimitBucket.findMany({
      orderBy: { scopeHash: 'asc' },
    });
    await forgot('expiry@example.test').expect(429);
    expect(
      (
        await admin.authRateLimitBucket.findMany({
          orderBy: { scopeHash: 'asc' },
        })
      ).map((row) => row.expiresAt),
    ).toEqual(before.map((row) => row.expiresAt));
    await admin.authRateLimitBucket.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await forgot('expiry@example.test', 1).expect(202);
  });
  it('admissão limita armazenamento e não expulsa contadores ativos; RLS nega leitura direta', async () => {
    await admin.$executeRaw`INSERT INTO auth_rate_limit_buckets(scope_hash, shard, attempts, expires_at)
      SELECT lpad(to_hex(n),64,'0'), 0, 1, clock_timestamp() + interval '1 minute' FROM generate_series(1,1024) AS n`;
    const runtime = apps[0]!.get(PrismaService);
    const key = '00' + 'f'.repeat(62);
    const consume = () => runtime.$queryRaw<{ allowed: boolean }[]>`
      SELECT * FROM app_auth_rate_limit_consume(${key}, 2, 60000)`;
    expect((await consume())[0]!.allowed).toBe(false);
    expect(await admin.authRateLimitBucket.count()).toBe(1024);
    expect(await runtime.authRateLimitBucket.findMany()).toEqual([]);
    await admin.authRateLimitBucket.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await consume())[0]!.allowed).toBe(true);
    expect(await admin.authRateLimitBucket.count()).toBeLessThanOrEqual(1024);
  });
});
