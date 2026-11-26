import { Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';

jest.setTimeout(90_000);

type Deployment = 'local' | 'staging';
const prefix = '/api/v1/corporate-admin';
const principalId = randomUUID();

function credential(
  environment: Deployment,
  keyId: string,
  options: {
    expired?: boolean;
    revoked?: boolean;
    noCapability?: boolean;
  } = {},
) {
  const secret = randomBytes(32).toString('base64url');
  const secretSha256 = createHash('sha256')
    .update(['orbit-corporate-admin.v1', environment, keyId, secret].join('\0'))
    .digest('hex');
  return {
    token: 'orbit-ca1.' + [environment, keyId, secret].join('.'),
    record: {
      keyId,
      environment,
      secretSha256,
      principalId,
      expiresAt: new Date(
        Date.now() + (options.expired ? -60_000 : 3600_000),
      ).toISOString(),
      revoked: options.revoked ?? false,
      capabilities: options.noCapability ? [] : ['connection:read'],
    },
  };
}

describe('ADM-01.A corporate authentication boundary', () => {
  const current = credential('local', 'current');
  const overlap = credential('local', 'overlap');
  const revoked = credential('local', 'old', { revoked: true });
  const expired = credential('local', 'expired', { expired: true });
  const limited = credential('local', 'no-scope', { noCapability: true });
  const staged = credential('staging', 'current');
  const apps: INestApplication<App>[] = [];
  let disabled: INestApplication<App>;
  let local: INestApplication<App>;
  let staging: INestApplication<App>;

  async function start(
    env: Deployment,
    fixtures: (typeof current)[],
  ): Promise<INestApplication<App>> {
    const variables = {
      ORBIT_DEPLOYMENT: env === 'local' ? undefined : env,
      ORBIT_CORPORATE_ADMIN_ENABLED: fixtures.length ? 'true' : 'false',
      ORBIT_CORPORATE_ADMIN_CREDENTIALS: JSON.stringify(
        fixtures.map((x) => x.record),
      ),
    };
    const previous = Object.fromEntries(
      Object.keys(variables).map((key) => [key, process.env[key]]),
    );
    for (const [key, value] of Object.entries(variables)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      const app = module.createNestApplication<INestApplication<App>>();
      apps.push(app);
      configureApiVersioning(app);
      await app.listen(0, '127.0.0.1');
      return app;
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  const get = (app: INestApplication<App>, suffix: string, token?: string) => {
    const call = request(app.getHttpServer()).get(prefix + suffix);
    return token ? call.set('Authorization', 'Bearer ' + token) : call;
  };

  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error(
        'Start the integration runner with a disposable database',
      );
    disabled = await start('local', []);
    local = await start('local', [current, overlap, revoked, expired, limited]);
    staging = await start('staging', [staged]);
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
  });

  it('returns 404 on every corporate route when disabled and keeps existing API reachable', async () => {
    for (const route of ['/connection', '/version', '/capabilities'])
      await get(disabled, route, current.token).expect(404);
    await request(disabled.getHttpServer()).get('/api/v1/release').expect(200);
  });

  it('allows only the three authenticated routes with closed responses and no-store', async () => {
    const responses = [
      ['/connection', { status: 'ok' }],
      ['/version', { service: 'orbit-corporate-admin', version: '1.0.0' }],
      ['/capabilities', { capabilities: ['connection:read'] }],
    ] as const;
    for (const [route, expected] of responses) {
      const id = randomUUID();
      const result = await get(local, route, current.token)
        .set('X-Correlation-Id', id)
        .expect('X-Correlation-Id', id)
        .expect('Cache-Control', 'private, no-store')
        .expect(200);
      expect(result.body).toMatchObject({ success: true, requestId: id });
      expect((result.body as { data: unknown }).data).toEqual(expected);
    }
    await get(local, '/organizations', current.token).expect(404);
    await request(local.getHttpServer())
      .get('/corporate-admin/connection')
      .set('Authorization', 'Bearer ' + current.token)
      .expect(404);
  });

  it('supports an overlap for rotation and rejects unknown, invalid, expired and revoked tokens uniformly', async () => {
    await get(local, '/connection', overlap.token).expect(200);
    const [scheme, environment, key] = current.token.split('.');
    const incorrect = [
      scheme,
      environment,
      key,
      randomBytes(32).toString('base64url'),
    ].join('.');
    const unknown = current.token.replace('.current.', '.unknown.');
    for (const token of [
      undefined,
      incorrect,
      unknown,
      expired.token,
      revoked.token,
      'a.human.jwt',
    ]) {
      const result = await get(local, '/connection', token)
        .expect('WWW-Authenticate', /^Bearer/)
        .expect(401);
      expect((result.body as { error: { code: string } }).error.code).toBe(
        'UNAUTHORIZED',
      );
    }
  });

  it('never derives scope from human headers or accepts the machine at existing human endpoints', async () => {
    await get(local, '/capabilities', limited.token)
      .set('X-Operator-Role', 'PLATFORM_ADMIN')
      .set('X-Operator-Id', principalId)
      .expect(403);
    await request(local.getHttpServer())
      .get('/api/v1/platform-admin/overview')
      .set('Authorization', 'Bearer ' + current.token)
      .expect(401);
    await request(local.getHttpServer())
      .get('/api/v1/identity/me')
      .set('Authorization', 'Bearer ' + current.token)
      .expect(401);
  });

  it('requires an attested HTTPS hop in staging and rejects credentials from a different environment', async () => {
    const send = (token: string, proxySecret: string) =>
      get(staging, '/connection', token)
        .set('X-Forwarded-Proto', 'https')
        .set('X-Orbit-Proxy-Secret', proxySecret);
    const trusted = process.env.TRUSTED_PROXY_SECRET!;
    await get(staging, '/connection', staged.token).expect(403);
    await send(staged.token, randomBytes(32).toString('hex')).expect(403);
    await send(staged.token, trusted).expect(200);
    await send(current.token, trusted).expect(401);
    await send(current.token.replace('.local.', '.staging.'), trusted).expect(
      401,
    );
    await get(local, '/connection', staged.token).expect(401);
  });

  it('registers the technical actor and correlation without logging credentials or verifier material', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => {});
    const id = randomUUID();
    try {
      await get(local, '/connection', current.token)
        .set('X-Correlation-Id', id)
        .expect(200);
      await get(local, '/connection', limited.token)
        .set('X-Correlation-Id', id)
        .expect(403);
      expect(log).toHaveBeenCalledWith({
        event: 'corporate_admin_access',
        role: 'TECHNICAL',
        operation: 'connection',
        correlationId: id,
        technicalPrincipalId: principalId,
        outcome: 'allowed',
        code: 'ALLOWED',
      });
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'corporate_admin_access',
          technicalPrincipalId: principalId,
          operation: 'connection',
          correlationId: id,
          outcome: 'denied',
          code: 'CAPABILITY_REQUIRED',
        }),
      );
      const text = JSON.stringify(log.mock.calls);
      expect(text).not.toContain(current.token);
      expect(text).not.toContain(current.record.secretSha256);
    } finally {
      log.mockRestore();
    }
  });

  it('rate limits corporate routes in one budget without using the login budget', async () => {
    const previous = process.env.AUTH_RATE_LIMIT_ORIGIN_MAX;
    process.env.AUTH_RATE_LIMIT_ORIGIN_MAX = '2';
    const corporate = (route: string) =>
      get(staging, route, staged.token)
        .set('X-Forwarded-Proto', 'https')
        .set('X-Orbit-Proxy-Secret', process.env.TRUSTED_PROXY_SECRET!)
        .set('X-Orbit-Client-Ip', '192.0.2.71');
    try {
      await corporate('/connection').expect(200);
      await corporate('/version').expect(200);
      await corporate('/capabilities')
        .expect('Retry-After', /^\d+$/)
        .expect(429);
      await request(staging.getHttpServer())
        .post('/api/v1/identity/login')
        .set('X-Orbit-Proxy-Secret', process.env.TRUSTED_PROXY_SECRET!)
        .set('X-Orbit-Client-Ip', '192.0.2.71')
        .send({
          email: 'corporate-test@example.test',
          password: 'synthetic-failure-only',
        })
        .expect(401);
    } finally {
      if (previous === undefined) delete process.env.AUTH_RATE_LIMIT_ORIGIN_MAX;
      else process.env.AUTH_RATE_LIMIT_ORIGIN_MAX = previous;
    }
  });
});
