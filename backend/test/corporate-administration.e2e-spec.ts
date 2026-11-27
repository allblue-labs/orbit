import { Logger, ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';
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
    capabilities?: string[];
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
      capabilities: options.capabilities ?? ['connection:read'],
    },
  };
}

describe('ADM-01.A corporate authentication boundary', () => {
  const current = credential('local', 'current');
  const overlap = credential('local', 'overlap');
  const revoked = credential('local', 'old', { revoked: true });
  const expired = credential('local', 'expired', { expired: true });
  const limited = credential('local', 'no-scope', { capabilities: [] });
  const staged = credential('staging', 'current');
  const reader = credential('local', 'directory-reader', {
    capabilities: ['organizations:read'],
  });
  const writer = credential('local', 'directory-writer', {
    capabilities: ['organizations:write'],
  });
  const apps: INestApplication<App>[] = [];
  let disabled: INestApplication<App>;
  let local: INestApplication<App>;
  let staging: INestApplication<App>;
  let alpha: { id: string; ownerUserId: string; updatedAt: Date };
  let beta: { id: string; updatedAt: Date };
  let deletedId: string;
  const organizationPath = '/organizations';
  const nexusAdministratorId = randomUUID();
  const syntheticDocument = '12345678000195';

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
      app.useGlobalPipes(
        new ValidationPipe({
          transform: true,
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
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
    local = await start('local', [
      current,
      overlap,
      revoked,
      expired,
      limited,
      reader,
      writer,
    ]);
    staging = await start('staging', [staged]);
  });

  afterAll(async () => {
    for (const app of apps) await app.close();
    await disconnectAdminPrisma();
  });

  it('returns 404 on every corporate route when disabled and keeps existing API reachable', async () => {
    for (const route of [
      '/connection',
      '/version',
      '/capabilities',
      organizationPath,
    ])
      await get(disabled, route, current.token).expect(404);
    await request(disabled.getHttpServer()).get('/api/v1/release').expect(200);
  });

  it('preserves the connection routes with closed responses and no-store', async () => {
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
    await get(local, organizationPath, current.token).expect(403);
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

  describe('ADM-02.A corporate customer directory', () => {
    const detail = (id: string, token = reader.token) =>
      get(local, organizationPath + '/' + id, token);
    const patch = (id: string, token = writer.token) =>
      request(local.getHttpServer())
        .patch(prefix + organizationPath + '/' + id)
        .set('Authorization', 'Bearer ' + token);
    const data = <T>(response: request.Response) =>
      (response.body as { data: T }).data;
    type Page = {
      items: Array<{ id: string }>;
      total: number;
      page: number;
      pageSize: number;
    };
    const directory = (
      query: Record<string, string | number | undefined> = {},
    ) => get(local, organizationPath, reader.token).query(query);
    const recorded = (requestId: string) =>
      adminPrisma().auditLog.findMany({ where: { requestId } });

    beforeAll(async () => {
      const db = adminPrisma();
      const plan = await db.plan.findFirstOrThrow({
        where: { key: 'ESSENTIAL' },
      });
      const owner = await db.user.create({
        data: {
          email: 'private-owner@synthetic.example.test',
          normalizedEmail: 'private-owner@synthetic.example.test',
          firstName: 'Responsável',
          lastName: 'Sintético',
          displayName: 'Responsável Sintético',
          phone: 'CANARY_PRIVATE_PHONE',
          status: 'ACTIVE',
        },
      });
      const base = {
        ownerUserId: owner.id,
        planId: plan.id,
        primarySegment: 'HVAC_R',
      };
      alpha = await db.organization.create({
        data: {
          ...base,
          slug: 'adm02a-alpha',
          displayName: 'Fixture Diretório Alfa',
          status: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
          externalCustomerId: 'CANARY_STRIPE_CUSTOMER',
          settings: { secret: 'CANARY_ORGANIZATION_SETTINGS' },
          createdAt: new Date('2026-04-01T10:00:00Z'),
        },
      });
      beta = await db.organization.create({
        data: {
          ...base,
          slug: 'adm02a-beta',
          displayName: 'Fixture Diretório Beta',
          status: 'SUSPENDED',
          createdAt: new Date('2026-05-01T10:00:00Z'),
        },
      });
      deletedId = (
        await db.organization.create({
          data: {
            ...base,
            slug: 'adm02a-deleted',
            displayName: 'Fixture Diretório Canceled',
            deletedAt: new Date(),
          },
        })
      ).id;
      await db.accountDocumentRegistration.create({
        data: {
          organizationId: alpha.id,
          documentNumber: syntheticDocument,
        },
      });
      await db.businessUnit.createMany({
        data: [
          {
            organizationId: alpha.id,
            slug: 'headquarters',
            isPrimary: true,
            legalName: 'Arco Climatização Ltda.',
            tradeName: 'Arco Clima',
            documentType: 'CNPJ',
            documentNumber: '12.345.678/0001-95',
            city: 'Recife',
            stateCode: 'PE',
            street: 'CANARY_FULL_STREET',
            district: 'Centro',
            email: 'administrativo@example.test',
            phone: '+558130000000',
          },
          {
            organizationId: alpha.id,
            slug: 'branch',
            legalName: 'Arco Filial',
            documentType: 'CNPJ',
            documentNumber: '12345678000276',
            city: 'Olinda',
            street: 'Rua fictícia',
            district: 'Centro',
          },
          {
            organizationId: alpha.id,
            slug: 'removed',
            legalName: 'CANARY_DELETED_BRANCH',
            documentType: 'CNPJ',
            documentNumber: '12345678000357',
            city: 'Olinda',
            street: 'Rua fictícia',
            district: 'Centro',
            deletedAt: new Date(),
          },
          {
            organizationId: beta.id,
            slug: 'headquarters',
            isPrimary: true,
            legalName: 'CANARY_OTHER_ORGANIZATION',
            documentType: 'CNPJ',
            documentNumber: '12345678000438',
            city: 'Recife',
            street: 'Rua fictícia',
            district: 'Centro',
          },
        ],
      });
      const role = await db.role.create({
        data: {
          organizationId: alpha.id,
          key: 'ADM02A_MEMBER',
          name: 'Membro sintético',
        },
      });
      await db.organizationMembership.create({
        data: {
          organizationId: alpha.id,
          userId: owner.id,
          roleId: role.id,
          status: 'ACTIVE',
        },
      });
      const clock = new Date();
      const periodStart = new Date(clock.getTime() - 10 * 86_400_000);
      const periodEnd = new Date(clock.getTime() + 20 * 86_400_000);
      const snapshot = {
        organizationId: alpha.id,
        billingInterval: 'MONTHLY',
        catalogVersion: 1,
        entitlementsSnapshot: { secret: 'CANARY_ENTITLEMENTS' },
        billingAnchorAt: periodStart,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        startedAt: periodStart,
      };
      await db.organizationSubscription.createMany({
        data: [
          {
            ...snapshot,
            status: 'TRIALING',
            planCode: 'ESSENTIAL',
            trialStartsAt: periodStart,
            trialEndsAt: new Date(clock.getTime() - 86_400_000),
            providerSubscriptionId: 'CANARY_PROVIDER_SUBSCRIPTION',
          },
          {
            ...snapshot,
            startedAt: clock,
            endedAt: clock,
            planCode: 'PROFESSIONAL',
            status: 'CANCELED',
          },
        ],
      });
    });

    it('lists stable, bounded pages with a shared total and applies date, state, name, ID, and document filters', async () => {
      const first = data<Page>(
        await directory({
          q: 'diretório',
          page: 1,
          pageSize: 1,
          sort: 'displayName',
          direction: 'asc',
        }).expect(200),
      );
      const second = data<Page>(
        await directory({
          q: 'diretório',
          page: 2,
          pageSize: 1,
          sort: 'displayName',
          direction: 'asc',
        }).expect(200),
      );
      const beyond = data<Page>(
        await directory({ q: 'diretório', page: 3, pageSize: 1 }).expect(200),
      );
      expect(first).toMatchObject({
        items: [{ id: alpha.id }],
        total: 2,
        page: 1,
        pageSize: 1,
      });
      expect(second).toMatchObject({ items: [{ id: beta.id }], total: 2 });
      expect(beyond).toMatchObject({ items: [], total: 2 });
      for (const q of [
        'ARCO CLIMA',
        alpha.id,
        '12.345.678/0001-95',
        syntheticDocument,
      ]) {
        expect(data<Page>(await directory({ q }).expect(200))).toMatchObject({
          items: [{ id: alpha.id }],
          total: 1,
        });
      }
      const narrowed = await directory({
        q: 'diretório',
        operationalStatus: 'SUSPENDED',
        registeredFrom: '2026-05-01T10:00:00Z',
        registeredBefore: '2026-06-01T00:00:00Z',
        subscriptionStatus: 'UNKNOWN',
      }).expect(200);
      expect(data<Page>(narrowed)).toMatchObject({
        items: [{ id: beta.id }],
        total: 1,
      });
      await directory({ pageSize: 101 }).expect(400);
      await directory({ sort: 'ownerEmail' }).expect(400);
      await directory({ registeredBefore: '2026-02-30T00:00:00Z' }).expect(400);
      await directory({
        registeredFrom: '2026-05-01T00:00:00Z',
        registeredBefore: '2026-04-01T00:00:00Z',
      }).expect(400);
    });

    it('filters by the canonical subscription and distinguishes its saved and effective status', async () => {
      const canonical = await directory({
        q: alpha.id,
        planCode: 'ESSENTIAL',
        subscriptionStatus: 'TRIALING',
      }).expect(200);
      expect(data<Page>(canonical)).toMatchObject({
        total: 1,
        items: [
          {
            id: alpha.id,
            subscription: {
              source: 'CANONICAL',
              planCode: 'ESSENTIAL',
              status: 'TRIALING',
              effectiveStatus: 'EXPIRED',
              accessGranted: false,
              trialStartsAt: expect.any(String) as unknown,
            },
          },
        ],
      });
      for (const filter of [
        { planCode: 'PROFESSIONAL' },
        { subscriptionStatus: 'CANCELED' },
        { subscriptionStatus: 'ACTIVE' },
      ]) {
        expect(
          data<Page>(await directory({ q: alpha.id, ...filter }).expect(200))
            .total,
        ).toBe(0);
      }
    });

    it('projects only this organization’s administrative details and records list and detail reads', async () => {
      const detailId = randomUUID();
      const listId = randomUUID();
      const response = await detail(alpha.id)
        .set('X-Correlation-Id', detailId)
        .set('X-Nexus-Administrator-Id', nexusAdministratorId)
        .expect('X-Correlation-Id', detailId)
        .expect('Cache-Control', 'private, no-store')
        .expect(200);
      expect(data(response)).toMatchObject({
        id: alpha.id,
        legalName: 'Arco Climatização Ltda.',
        tradeName: 'Arco Clima',
        operationalStatus: 'ACTIVE',
        operational: true,
        document: { type: 'CNPJ', number: '12.345.678/0001-95' },
        owner: { id: alpha.ownerUserId, displayName: 'Responsável Sintético' },
        administrativeContact: {
          email: 'administrativo@example.test',
          phone: '+558130000000',
        },
        userCount: 1,
        activeUserCount: 1,
        unitCount: 2,
        units: [
          { isPrimary: true, stateCode: 'PE' },
          { legalName: 'Arco Filial', isPrimary: false },
        ],
      });
      expect(response.text).not.toMatch(
        /CANARY|private-owner|providerManaged/i,
      );
      const list = await directory({ q: alpha.id })
        .set('X-Correlation-Id', listId)
        .expect(200);
      expect(data<Page>(list).items[0]).not.toHaveProperty(
        'administrativeContact',
      );
      expect(data<Page>(list).items[0]).not.toHaveProperty('owner');
      expect(await recorded(listId)).toMatchObject([
        {
          action: 'CORPORATE_ORGANIZATIONS_LISTED',
          organizationId: null,
          userId: null,
          metadata: { technicalPrincipalId: principalId, result: 'CONFIRMED' },
        },
      ]);
      expect(await recorded(detailId)).toMatchObject([
        {
          action: 'CORPORATE_ORGANIZATION_READ',
          organizationId: alpha.id,
          userId: null,
          metadata: {
            technicalPrincipalId: principalId,
            declaredNexusAdministratorId: nexusAdministratorId,
            result: 'CONFIRMED',
          },
        },
      ]);
    });

    it('requires independent capabilities and ignores Nexus actor claims for authentication', async () => {
      await get(local, organizationPath)
        .set('X-Nexus-Administrator-Id', nexusAdministratorId)
        .expect(401);
      await detail(alpha.id, writer.token).expect(403);
      await patch(alpha.id, reader.token)
        .set('X-Nexus-Administrator-Id', nexusAdministratorId)
        .send({
          displayName: 'Edição',
          expectedUpdatedAt: alpha.updatedAt.toISOString(),
        })
        .expect(403);
      await get(local, '/connection', reader.token).expect(403);
      await request(local.getHttpServer())
        .get('/api/v1/platform-admin/overview')
        .set('Authorization', 'Bearer ' + writer.token)
        .set('X-Nexus-Administrator-Id', nexusAdministratorId)
        .expect(401);
    });

    it('returns 404 for missing and deleted organizations and audits the requested entity', async () => {
      const id = randomUUID();
      const correlation = randomUUID();
      await detail(id).set('X-Correlation-Id', correlation).expect(404);
      await detail(deletedId).expect(404);
      await detail('invalid-id').expect(400);
      const patchCorrelation = randomUUID();
      await patch(id)
        .set('X-Correlation-Id', patchCorrelation)
        .set('X-Nexus-Administrator-Id', nexusAdministratorId)
        .send({
          displayName: 'Alterado',
          expectedUpdatedAt: alpha.updatedAt.toISOString(),
        })
        .expect(404);
      for (const auditId of [correlation, patchCorrelation]) {
        expect(await recorded(auditId)).toMatchObject([
          {
            organizationId: null,
            entityId: id,
            metadata: { result: 'NOT_FOUND' },
          },
        ]);
      }
    });

    it('rejects forbidden fields, unknown properties, invalid values and missing administrative references', async () => {
      const body = {
        displayName: 'Edição',
        expectedUpdatedAt: alpha.updatedAt.toISOString(),
      };
      await patch(alpha.id).send(body).expect(400);
      const update = () =>
        patch(alpha.id).set('X-Nexus-Administrator-Id', nexusAdministratorId);
      for (const forbidden of [
        'planCode',
        'subscriptionStatus',
        'status',
        'entitlementsSnapshot',
        'ownerUserId',
        'externalCustomerId',
        'deletedAt',
        'randomProperty',
      ]) {
        await update()
          .send({ ...body, [forbidden]: 'forbidden' })
          .expect(400);
      }
      for (const invalid of [
        { ...body, displayName: null },
        { ...body, displayName: ' ' },
        { ...body, expectedUpdatedAt: 'bad' },
        { expectedUpdatedAt: body.expectedUpdatedAt },
      ]) {
        await update().send(invalid).expect(400);
      }
    });

    it('serializes concurrent updates, records the conflict, and audits changed field names only', async () => {
      const originalVersion = alpha.updatedAt.toISOString();
      const auditIds = [randomUUID(), randomUUID()];
      const updated = await Promise.all(
        auditIds.map((audit, index) =>
          patch(alpha.id)
            .set('X-Correlation-Id', audit)
            .set('X-Nexus-Administrator-Id', nexusAdministratorId)
            .send({
              displayName: ' Nome ajustado ' + index,
              primarySegment: 'Refrigeração',
              expectedUpdatedAt: originalVersion,
            }),
        ),
      );
      expect(updated.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const success = updated.find((response) => response.status === 200)!;
      const version = data<{ updatedAt: string }>(success).updatedAt;
      expect(Date.parse(version)).toBeGreaterThan(Date.parse(originalVersion));
      expect(data(success)).toEqual({
        id: alpha.id,
        updatedAt: version,
        changedFields: ['displayName', 'primarySegment'],
      });
      expect(data(await detail(alpha.id).expect(200))).toMatchObject({
        displayName: expect.stringMatching(/^Nome ajustado [01]$/) as unknown,
        primarySegment: 'Refrigeração',
        updatedAt: version,
      });
      for (const [index, audit] of auditIds.entries()) {
        const applied = updated[index]?.status === 200;
        expect(await recorded(audit)).toMatchObject([
          {
            organizationId: alpha.id,
            userId: null,
            before: null,
            after: null,
            metadata: {
              technicalPrincipalId: principalId,
              declaredNexusAdministratorId: nexusAdministratorId,
              changedFields: applied ? ['displayName', 'primarySegment'] : [],
              result: applied ? 'CONFIRMED' : 'VERSION_CONFLICT',
            },
          },
        ]);
      }
      const unchanged = await patch(alpha.id)
        .set('X-Nexus-Administrator-Id', nexusAdministratorId)
        .send({ primarySegment: 'Refrigeração', expectedUpdatedAt: version })
        .expect(200);
      expect(data(unchanged)).toMatchObject({
        updatedAt: version,
        changedFields: [],
      });
    });

    it('rolls back a metadata update if its audit insert fails', async () => {
      const db = adminPrisma();
      const correlation = randomUUID();
      await db.$executeRawUnsafe(
        "CREATE FUNCTION public.adm02a_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$",
      );
      try {
        await db.$executeRawUnsafe(`CREATE TRIGGER adm02a_test_audit_failure BEFORE INSERT ON public.audit_logs
          FOR EACH ROW WHEN (NEW.request_id = '${correlation}') EXECUTE FUNCTION public.adm02a_test_audit_failure()`);
        await patch(beta.id)
          .set('X-Correlation-Id', correlation)
          .set('X-Nexus-Administrator-Id', nexusAdministratorId)
          .send({
            displayName: 'Mudança revertida',
            expectedUpdatedAt: beta.updatedAt.toISOString(),
          })
          .expect(500);
        expect(
          await db.organization.findUnique({ where: { id: beta.id } }),
        ).toMatchObject({
          displayName: 'Fixture Diretório Beta',
          updatedAt: beta.updatedAt,
          status: 'SUSPENDED',
        });
        expect(await recorded(correlation)).toEqual([]);
      } finally {
        await db.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS adm02a_test_audit_failure ON public.audit_logs',
        );
        await db.$executeRawUnsafe(
          'DROP FUNCTION public.adm02a_test_audit_failure()',
        );
      }
    });

    it('keeps runtime RLS and restricts the directory role to selected columns', async () => {
      const pool = new Pool({ connectionString: process.env.APP_DATABASE_URL });
      try {
        const { rows } = await pool.query<{
          visible: string;
          can_assume: boolean;
          no_login: boolean;
          no_bypass: boolean;
          stripe: boolean;
          change_status: boolean;
        }>(
          `SELECT (SELECT count(*) FROM public.organizations WHERE id = $1::uuid)::text AS visible,
          pg_has_role(current_user, 'orbit_corporate_directory', 'MEMBER') AS can_assume,
          (SELECT NOT rolcanlogin FROM pg_roles WHERE rolname = 'orbit_corporate_directory') AS no_login,
          (SELECT NOT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname = 'orbit_corporate_directory') AS no_bypass,
          has_column_privilege('orbit_corporate_directory','public.organizations','external_customer_id','SELECT') AS stripe,
          has_column_privilege('orbit_corporate_directory','public.organizations','status','UPDATE') AS change_status`,
          [alpha.id],
        );
        expect(rows[0]).toEqual({
          visible: '0',
          can_assume: false,
          no_login: true,
          no_bypass: true,
          stripe: false,
          change_status: false,
        });
      } finally {
        await pool.end();
      }
    });
  });
});
