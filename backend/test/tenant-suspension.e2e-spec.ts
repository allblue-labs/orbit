import {
  Body,
  Controller,
  Get,
  Post,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import {
  RequestContext,
  RequestContextService,
  RequestContextStorage,
} from '../src/context';
import type { IHashProvider, UUID } from '../src/contracts';
import { RlsTransaction } from '../src/database';
import { Permissions, Surfaces } from '../src/decorators';
import { HASH_PROVIDER } from '../src/providers';
import { BackgroundJobQueue } from '../src/modules/jobs/background-job.queue';
import { BackgroundJobWorker } from '../src/modules/jobs/background-job.worker';
import { JobProcessorRegistry } from '../src/modules/jobs/job-processor.registry';
import {
  JOB_QUEUES,
  type JobProcessor,
  type JobQueue,
} from '../src/modules/jobs/background-job.types';
import { RequiresActivePlan } from '../src/modules/subscription-plans/plan-access';
import { snapshotOf } from '../src/modules/subscription-plans/subscriptions/subscription.snapshot';
import { planDefinition } from '../src/modules/subscription-plans/catalog/plan-registry';
import { CATALOG_VERSION } from '../src/modules/subscription-plans/catalog/plan-catalog.types';
import { IdentityTokenService } from '../src/modules/identity/application/token.service';
import { NotificationGateway } from '../src/modules/notifications/notification.gateway';
import {
  STORAGE_CONFIG,
  type StorageConfig,
} from '../src/modules/storage/storage.config';
import { uploadGrant } from '../src/modules/storage/upload-grant';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

/** Product probe uses the actual global guards, session resolution and restricted RLS connection. */
@Controller('nx03-test')
@Surfaces('WEB', 'MOBILE', 'API')
@RequiresActivePlan()
class OperationalProbe {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly contexts: RequestContextService,
  ) {}
  @Get()
  read() {
    return this.rls.run(async (tx) => ({
      organizations: await tx.$queryRaw`SELECT id FROM organizations`,
      units: await tx.$queryRaw`SELECT id FROM business_units`,
      runtime:
        await tx.$queryRaw`SELECT current_user AS name, rolsuper, rolbypassrls, current_setting('app.is_platform_admin',true) AS platform FROM pg_roles WHERE rolname=current_user`,
    }));
  }
  @Post('privileged')
  @Permissions('operations.manage')
  privileged() {
    return { accepted: true };
  }

  @Post()
  write(@Body() body: { organizationId?: string }) {
    // Deliberately ignores untrusted tenant selection.
    void body;
    const ctx = this.contexts.get();
    return this.rls.run((tx) =>
      tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          action: 'NX03_TEST_WRITE',
          entityType: 'TEST',
          requestId: ctx.requestId,
        },
      }),
    );
  }
}
interface Pair {
  accessToken: string;
  refreshToken: string;
}
interface Tenant {
  id: string;
  ownerId: string;
  email: string;
  unitId: string;
  subscriptionId: string;
  pair: Pair;
}
interface Decision {
  decisionId: string;
  replayed: boolean;
  decision: { status: string; result: string };
  current: { status: string; updatedAt: string };
}
const data = <T>(response: request.Response) =>
  (response.body as { data: T }).data;
const password = 'Orbit#Suspension@2026';

describe('ORB-NX-03 operational suspension (real HTTP / restricted PostgreSQL)', () => {
  const admin = adminPrisma();
  let app: INestApplication<App>,
    runtime: Pool,
    passwordHash: string,
    platformRoleId: string,
    globalToken: string;
  const users: string[] = [],
    tenants: string[] = [];
  let tenant: Tenant;
  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, token = globalToken) =>
    req.set('Authorization', `Bearer ${token}`);
  async function user(label: string) {
    const email = `nx03.${label}.${randomUUID()}@example.test`.toLowerCase();
    const row = await admin.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Teste',
        lastName: label,
        displayName: label,
        status: 'ACTIVE',
        credential: { create: { passwordHash } },
      },
    });
    users.push(row.id);
    return row;
  }
  async function login(email: string, client = 'WEB'): Promise<Pair> {
    return data<Pair>(
      await http()
        .post('/api/v1/identity/login')
        .send({ email, password, client })
        .expect(200),
    );
  }
  async function fixture(
    status = 'ACTIVE',
    subscriptionStatus = 'ACTIVE',
  ): Promise<Tenant> {
    const owner = await user('owner');
    const plan = await admin.plan.findFirstOrThrow({
      where: { isActive: true },
    });
    const organization = await admin.organization.create({
      data: {
        ownerUserId: owner.id,
        planId: plan.id,
        slug: `nx03-${randomUUID()}`,
        displayName: 'NX03 tenant',
        primarySegment: 'HVAC',
        status,
        subscriptionStatus: 'ACTIVE',
      },
    });
    tenants.push(organization.id);
    const role = await admin.role.create({
      data: {
        organizationId: organization.id,
        key: 'OWNER',
        name: 'Proprietário',
        permissions: ['*'],
        allowedSurfaces: ['WEB', 'MOBILE', 'API'],
      },
    });
    await admin.organizationMembership.create({
      data: {
        organizationId: organization.id,
        userId: owner.id,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    const unit = await admin.businessUnit.create({
      data: {
        organizationId: organization.id,
        slug: 'matriz',
        type: 'HEADQUARTERS',
        isPrimary: true,
        legalName: 'NX03 LTDA',
        documentType: 'CNPJ',
        documentNumber: randomUUID().replace(/-/g, '').slice(0, 14),
        city: 'Recife',
        street: 'Rua teste',
        status: 'ACTIVE',
      },
    });
    const now = new Date();
    const end = new Date(Date.now() + 7 * 86400000);
    const subscription = await admin.organizationSubscription.create({
      data: {
        organizationId: organization.id,
        planCode: 'PROFESSIONAL',
        catalogVersion: CATALOG_VERSION,
        entitlementsSnapshot: snapshotOf(
          planDefinition('PROFESSIONAL'),
        ) as unknown as Prisma.InputJsonValue,
        billingInterval: 'MONTHLY',
        status: subscriptionStatus,
        billingAnchorAt: now,
        currentPeriodStart: now,
        currentPeriodEnd:
          subscriptionStatus === 'EXPIRED'
            ? new Date(Date.now() - 86400000)
            : end,
        trialStartsAt: subscriptionStatus === 'TRIALING' ? now : null,
        trialEndsAt: subscriptionStatus === 'TRIALING' ? end : null,
      },
    });
    return {
      id: organization.id,
      ownerId: owner.id,
      email: owner.email,
      unitId: unit.id,
      subscriptionId: subscription.id,
      pair: await login(owner.email),
    };
  }
  async function change(
    t: Tenant,
    status: 'ACTIVE' | 'SUSPENDED',
    reason = 'ADMINISTRATIVE',
    key = randomUUID(),
    expected?: string,
  ) {
    const row = await admin.organization.findUniqueOrThrow({
      where: { id: t.id },
    });
    return auth(
      http().post(
        `/api/v1/platform-admin/organizations/${t.id}/operational-status`,
      ),
    )
      .set('Idempotency-Key', key)
      .send({
        status,
        reason,
        expectedUpdatedAt: expected ?? row.updatedAt.toISOString(),
      });
  }
  function inTenant<T>(t: Tenant, work: () => Promise<T>) {
    return app.get(RequestContextStorage).run(
      new RequestContext({
        requestId: randomUUID(),
        actorType: 'SYSTEM',
        userId: t.ownerId as UUID,
        organizationId: t.id as UUID,
        businessUnitId: t.unitId as UUID,
        businessUnitIds: [t.unitId as UUID],
        roles: [],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      work,
    );
  }
  async function enqueue(
    t: Tenant,
    queue: JobQueue = JOB_QUEUES.artifactRender,
    availableAt?: Date,
  ) {
    return inTenant(t, () =>
      app.get(BackgroundJobQueue).enqueue({
        organizationId: t.id,
        businessUnitId: t.unitId,
        scope: 'BUSINESS_UNIT',
        queue,
        jobKey: `nx03-${randomUUID()}`,
        payload: {},
        correlationId: randomUUID(),
        actorUserId: t.ownerId,
        availableAt,
      }),
    );
  }
  function processor(queue: JobQueue, work?: () => Promise<void>) {
    const process = jest.fn(
      work ??
        (() =>
          app.get(RlsTransaction).run(async (tx) => {
            await tx.auditLog.create({
              data: {
                organizationId: tenant.id,
                action: 'NX03_JOB_EFFECT',
                entityType: 'TEST',
              },
            });
          })),
    );
    const entry: JobProcessor = { queue, process };
    jest.spyOn(app.get(JobProcessorRegistry), 'all').mockReturnValue([entry]);
    return process;
  }
  beforeAll(async () => {
    if (
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_') ||
      !process.env.APP_DATABASE_URL
    )
      throw Error('Disposable restricted database required');
    const module = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [OperationalProbe],
    }).compile();
    app = module.createNestApplication<INestApplication<App>>();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
    runtime = new Pool({ connectionString: process.env.APP_DATABASE_URL });
    passwordHash = await app.get<IHashProvider>(HASH_PROVIDER).hash(password);
    const role = await admin.role.create({
      data: {
        key: 'PLATFORM_ADMIN',
        name: 'NX03 global admin',
        permissions: ['*', 'platform.admin'],
        allowedSurfaces: ['WEB', 'MOBILE', 'API'],
        isSystem: true,
      },
    });
    platformRoleId = role.id;
    const actor = await user('admin');
    await admin.platformRoleAssignment.create({
      data: { userId: actor.id, roleId: role.id },
    });
    globalToken = (await login(actor.email)).accessToken;
  });
  beforeEach(async () => {
    tenant = await fixture();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await runtime?.end();
    await app?.close();
    await admin.organization.deleteMany({ where: { id: { in: tenants } } });
    await admin.user.deleteMany({ where: { id: { in: users } } });
    if (platformRoleId)
      await admin.role.delete({ where: { id: platformRoleId } });
    await disconnectAdminPrisma();
  });

  it('runs with forced RLS and no SUPERUSER/BYPASSRLS', async () => {
    const response = await auth(
      http().get('/api/v1/nx03-test'),
      tenant.pair.accessToken,
    ).expect(200);
    expect(data<{ runtime: unknown[] }>(response).runtime).toEqual([
      {
        name: 'orbit_app',
        rolsuper: false,
        rolbypassrls: false,
        platform: 'false',
      },
    ]);
    const enforced = await runtime.query<{ relforcerowsecurity: boolean }>(
      "SELECT relforcerowsecurity FROM pg_class WHERE relname IN ('organizations','business_units','audit_logs','background_jobs')",
    );
    expect(enforced.rows.every((r) => r.relforcerowsecurity)).toBe(true);
  });
  it.each([
    ['ACTIVE', 'ACTIVE', 200, 201],
    ['SUSPENDED', 'ACTIVE', 403, 403],
    ['SUSPENDED', 'TRIALING', 403, 403],
    ['ACTIVE', 'EXPIRED', 200, 402],
    ['ACTIVE', 'PENDING_PAYMENT', 402, 402],
  ])(
    'operational %s / canonical %s preserves independent read and write gates',
    async (status, canonical, read, write) => {
      await admin.organization.update({
        where: { id: tenant.id },
        data: { status: status },
      });
      await admin.organizationSubscription.update({
        where: { id: tenant.subscriptionId },
        data: {
          status: canonical,
          billingAnchorAt: new Date(Date.now() - 30 * 86400000),
          currentPeriodStart: new Date(Date.now() - 30 * 86400000),
          trialStartsAt: canonical === 'TRIALING' ? new Date() : null,
          trialEndsAt:
            canonical === 'TRIALING' ? new Date(Date.now() + 86400000) : null,
          currentPeriodEnd: new Date(
            Date.now() + (canonical === 'EXPIRED' ? -1 : 1) * 86400000,
          ),
        },
      });
      await auth(
        http().get('/api/v1/nx03-test'),
        tenant.pair.accessToken,
      ).expect(read);
      await auth(http().post('/api/v1/nx03-test'), tenant.pair.accessToken)
        .send({})
        .expect(write);
    },
  );
  it.each(['WEB', 'MOBILE', 'API'])(
    'blocks an existing %s session on the next operational request without trusting old JWT claims',
    async (client) => {
      const pair = await login(tenant.email, client);
      await auth(http().get('/api/v1/nx03-test'), pair.accessToken).expect(200);
      await change(tenant, 'SUSPENDED').then((r) => expect(r.status).toBe(201));
      const response = await auth(
        http().get('/api/v1/nx03-test'),
        pair.accessToken,
      ).expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'ORGANIZATION_SUSPENDED' },
      });
      const refreshed = data<Pair>(
        await http()
          .post('/api/v1/identity/refresh')
          .send({ refreshToken: pair.refreshToken })
          .expect(200),
      );
      await auth(http().post('/api/v1/nx03-test'), refreshed.accessToken)
        .send({})
        .expect(403);
    },
  );
  it('keeps identity, recovery, billing and own restriction status available without granting operational access', async () => {
    await change(tenant, 'SUSPENDED');
    const pair = await login(tenant.email);
    for (const path of [
      'identity/me/access',
      'identity/me/sessions',
      'organizations/current',
      'organizations/current/subscription-details',
      'billing/overview',
      'legal/acceptance',
      'organizations/current/operational-access',
    ])
      await auth(http().get('/api/v1/' + path), pair.accessToken).expect(200);
    const state = data<{
      status: string;
      operational: boolean;
      reason: string;
    }>(
      await auth(
        http().get('/api/v1/organizations/current/operational-access'),
        pair.accessToken,
      ).expect(200),
    );
    expect(state).toMatchObject({
      status: 'SUSPENDED',
      operational: false,
      reason: 'ADMINISTRATIVE',
    });
    await auth(http().get('/api/v1/mobile/devices'), pair.accessToken).expect(
      200,
    );
    await auth(
      http().delete('/api/v1/mobile/devices/nx03-not-registered'),
      pair.accessToken,
    ).expect(204);
    await auth(
      http().get('/api/v1/mobile/field/home'),
      pair.accessToken,
    ).expect(403);
    await auth(
      http().post(
        '/api/v1/platform-admin/organizations/' +
          tenant.id +
          '/operational-status',
      ),
      pair.accessToken,
    )
      .send({})
      .expect(403);
    await auth(http().post('/api/v1/identity/logout'), pair.accessToken)
      .send({ refreshToken: pair.refreshToken })
      .expect(204);
  });
  it('reactivates a valid contract without touching any canonical financial field or Stripe link', async () => {
    await admin.organizationSubscription.update({
      where: { id: tenant.subscriptionId },
      data: {
        cancelAtPeriodEnd: true,
        provider: 'STRIPE',
        providerSubscriptionId: 'sub_nx03_synthetic',
      },
    });
    const before = await admin.organizationSubscription.findUniqueOrThrow({
      where: { id: tenant.subscriptionId },
    });
    await change(tenant, 'SUSPENDED');
    await change(tenant, 'ACTIVE', 'RESOLVED');
    await auth(http().post('/api/v1/nx03-test'), tenant.pair.accessToken)
      .send({})
      .expect(201);
    const after = await admin.organizationSubscription.findUniqueOrThrow({
      where: { id: tenant.subscriptionId },
    });
    expect(after).toEqual(before);
    expect(
      await admin.subscriptionTrialGrant.count({
        where: { organizationId: tenant.id },
      }),
    ).toBe(0);
  });
  it('does not restore permissions revoked while operationally suspended', async () => {
    const member = await user('revoked-member');
    const role = await admin.role.create({
      data: {
        organizationId: tenant.id,
        key: 'REVOCABLE',
        name: 'Equipe',
        permissions: ['operations.manage'],
        allowedSurfaces: ['WEB'],
      },
    });
    await admin.organizationMembership.create({
      data: {
        organizationId: tenant.id,
        userId: member.id,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    await admin.businessUnitMembership.create({
      data: {
        organizationId: tenant.id,
        businessUnitId: tenant.unitId,
        userId: member.id,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    const pair = await login(member.email);
    await auth(http().post('/api/v1/nx03-test/privileged'), pair.accessToken)
      .send({})
      .expect(201);
    await change(tenant, 'SUSPENDED');
    await admin.role.update({
      where: { id: role.id },
      data: { permissions: [] },
    });
    await change(tenant, 'ACTIVE', 'RESOLVED');
    await auth(http().post('/api/v1/nx03-test/privileged'), pair.accessToken)
      .send({})
      .expect(403);
    expect(
      (await admin.role.findUniqueOrThrow({ where: { id: role.id } }))
        .permissions,
    ).toEqual([]);
  });

  it('does not revive the legacy financial fallback when there is no canonical contract', async () => {
    await change(tenant, 'SUSPENDED');
    await admin.organizationSubscription.delete({
      where: { id: tenant.subscriptionId },
    });
    const result = await change(tenant, 'ACTIVE', 'RESOLVED');
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      error: { code: 'ORGANIZATION_REACTIVATION_REQUIRES_SUBSCRIPTION' },
    });
    expect(
      (await admin.organization.findUniqueOrThrow({ where: { id: tenant.id } }))
        .status,
    ).toBe('SUSPENDED');
    await auth(http().post('/api/v1/nx03-test'), tenant.pair.accessToken)
      .send({})
      .expect(403);
    expect(
      await admin.organizationSubscription.count({
        where: { organizationId: tenant.id },
      }),
    ).toBe(0);
    expect(
      await admin.subscriptionTrialGrant.count({
        where: { organizationId: tenant.id },
      }),
    ).toBe(0);
  });

  it('reactivation of an ended contract does not grant writes, trial or paid rights', async () => {
    await admin.organizationSubscription.update({
      where: { id: tenant.subscriptionId },
      data: {
        status: 'EXPIRED',
        billingAnchorAt: new Date(Date.now() - 30 * 86400000),
        currentPeriodStart: new Date(Date.now() - 30 * 86400000),
        currentPeriodEnd: new Date(Date.now() - 86400000),
      },
    });
    await change(tenant, 'SUSPENDED');
    await change(tenant, 'ACTIVE', 'RESOLVED');
    await auth(http().get('/api/v1/nx03-test'), tenant.pair.accessToken).expect(
      200,
    );
    await auth(http().post('/api/v1/nx03-test'), tenant.pair.accessToken)
      .send({})
      .expect(402);
    expect(
      (
        await admin.organizationSubscription.findUniqueOrThrow({
          where: { id: tenant.subscriptionId },
        })
      ).status,
    ).toBe('EXPIRED');
    expect(
      await admin.subscriptionTrialGrant.count({
        where: { organizationId: tenant.id },
      }),
    ).toBe(0);
  });
  it('serializes opposite decisions and rejects a stale administrative version', async () => {
    const row = await admin.organization.update({
      where: { id: tenant.id },
      data: { status: 'ONBOARDING' },
    });
    const results = await Promise.all([
      change(
        tenant,
        'SUSPENDED',
        'SECURITY',
        randomUUID(),
        row.updatedAt.toISOString(),
      ),
      change(
        tenant,
        'ACTIVE',
        'RESOLVED',
        randomUUID(),
        row.updatedAt.toISOString(),
      ),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(
      await admin.auditLog.count({
        where: {
          organizationId: tenant.id,
          action: 'TENANT_OPERATIONAL_STATUS_CHANGED',
        },
      }),
    ).toBe(1);
    expect(
      await admin.auditLog.count({
        where: {
          organizationId: tenant.id,
          action: 'TENANT_OPERATIONAL_STATUS_REJECTED',
        },
      }),
    ).toBe(1);
  });
  it('persists one receipt for concurrent duplicates, rejects payload reuse and records an explicit no-op', async () => {
    const row = await admin.organization.findUniqueOrThrow({
      where: { id: tenant.id },
    });
    const key = randomUUID();
    const expected = row.updatedAt.toISOString();
    const results = await Promise.all([
      change(tenant, 'SUSPENDED', 'SECURITY', key, expected),
      change(tenant, 'SUSPENDED', 'SECURITY', key, expected),
    ]);
    results.forEach((r) => expect(r.status).toBe(201));
    expect(data<Decision>(results[0]).decisionId).toBe(
      data<Decision>(results[1]).decisionId,
    );
    expect(results.map((r) => data<Decision>(r).replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(
      (await change(tenant, 'ACTIVE', 'RESOLVED', key, expected)).status,
    ).toBe(409);
    const noop = data<Decision>(
      await change(tenant, 'SUSPENDED', 'ADMINISTRATIVE'),
    );
    expect(noop.decision.result).toBe('NO_CHANGE');
    const unchangedReason = data<{ reason: string }>(
      await auth(
        http().get('/api/v1/organizations/current/operational-access'),
        tenant.pair.accessToken,
      ).expect(200),
    );
    expect(unchangedReason.reason).toBe('SECURITY');
    const receipt = await admin.auditLog.findUniqueOrThrow({
      where: { id: noop.decisionId },
    });
    await change(tenant, 'ACTIVE', 'RESOLVED');
    const replay = data<Decision>(
      await change(tenant, 'SUSPENDED', 'SECURITY', key, expected),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.decision.status).toBe('SUSPENDED');
    expect(replay.current.status).toBe('ACTIVE');

    expect(receipt.metadata).toMatchObject({
      authoritySource: 'PLATFORM_ROLE_ASSIGNMENT',
      result: 'NO_CHANGE',
    });
  });
  it('enforces tenant/unit isolation and refuses unauthorized target selection, including nonexistent targets', async () => {
    const other = await fixture();
    const member = await user('member');
    const role = await admin.role.create({
      data: {
        organizationId: tenant.id,
        key: 'FIELD',
        name: 'Campo',
        permissions: ['organization.read'],
        allowedSurfaces: ['WEB', 'API'],
      },
    });
    await admin.organizationMembership.create({
      data: {
        organizationId: tenant.id,
        userId: member.id,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    await admin.businessUnitMembership.create({
      data: {
        organizationId: tenant.id,
        businessUnitId: tenant.unitId,
        userId: member.id,
        roleId: role.id,
        status: 'ACTIVE',
      },
    });
    await admin.businessUnit.create({
      data: {
        organizationId: tenant.id,
        slug: 'filial',
        legalName: 'Filial',
        documentType: 'CNPJ',
        documentNumber: '12345678000195',
        city: 'Recife',
        street: 'Outra rua',
        status: 'ACTIVE',
      },
    });
    const pair = await login(member.email);
    const scoped = data<{
      organizations: { id: string }[];
      units: { id: string }[];
    }>(
      await auth(
        http().get('/api/v1/nx03-test?organizationId=' + other.id),
        pair.accessToken,
      ).expect(200),
    );
    expect(scoped.organizations.map((x) => x.id)).toEqual([tenant.id]);
    expect(scoped.units.map((x) => x.id)).toEqual([tenant.unitId]);
    for (const target of [other.id, randomUUID()])
      await auth(
        http().post(
          `/api/v1/platform-admin/organizations/${target}/operational-status`,
        ),
        pair.accessToken,
      )
        .send({})
        .expect(403);
    await change(tenant, 'SUSPENDED');
    await auth(
      http().get('/api/v1/nx03-test').set('x-organization-id', other.id),
      pair.accessToken,
    ).expect(403);
    await auth(http().get('/api/v1/nx03-test'), other.pair.accessToken).expect(
      200,
    );
    await auth(
      http().get('/api/v1/organizations/current/subscription-details'),
      pair.accessToken,
    ).expect(403);
  });
  it('grants administrative recovery only with current persisted global authority, never a product bypass', async () => {
    const grant = await admin.platformRoleAssignment.create({
      data: { userId: tenant.ownerId, roleId: platformRoleId },
    });
    await change(tenant, 'SUSPENDED');
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      tenant.pair.accessToken,
    ).expect(200);
    await auth(http().get('/api/v1/nx03-test'), tenant.pair.accessToken).expect(
      403,
    );
    await admin.platformRoleAssignment.update({
      where: { id: grant.id },
      data: { revokedAt: new Date() },
    });
    await auth(
      http().get('/api/v1/platform-admin/overview'),
      tenant.pair.accessToken,
    ).expect(403);
    const tokens = app.get(IdentityTokenService),
      claims = await tokens.verifyAccessToken(tenant.pair.accessToken);
    const forged = await tokens.issue({
      id: claims.sub,
      sessionId: claims.sid,
      organizationId: claims.organizationId,
      businessUnitId: claims.businessUnitId,
      businessUnitIds: claims.businessUnitIds,
      roles: ['PLATFORM_ADMIN'],
      permissions: ['*', 'platform.admin'],
      allowedSurfaces: ['WEB'],
      isOrganizationOwner: true,
    });
    await auth(
      http().post(
        `/api/v1/platform-admin/organizations/${tenant.id}/operational-status`,
      ),
      forged.accessToken,
    )
      .send({})
      .expect(403);
  });
  it('defers already queued operational work without exhausting attempts and wakes the same job after reactivation', async () => {
    const job = await enqueue(tenant);
    const process = processor(JOB_QUEUES.artifactRender);
    await change(tenant, 'SUSPENDED');
    await app.get(BackgroundJobWorker).tick();
    expect(process).not.toHaveBeenCalled();
    const paused = await admin.backgroundJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(paused).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      lastError: 'ORGANIZATION_SUSPENDED',
      lockedAt: null,
    });
    expect(paused.availableAt.getTime()).toBeGreaterThan(Date.now());
    await app.get(BackgroundJobWorker).tick();
    expect(process).not.toHaveBeenCalled();
    const future = await enqueue(
      tenant,
      JOB_QUEUES.artifactRender,
      new Date(Date.now() + 86400000),
    );
    await change(tenant, 'ACTIVE', 'RESOLVED');
    expect(
      (
        await admin.backgroundJob.findUniqueOrThrow({
          where: { id: future.id },
        })
      ).availableAt,
    ).toEqual(future.availableAt);
    await app.get(BackgroundJobWorker).tick();
    expect(process).toHaveBeenCalledTimes(1);
    expect(
      (await admin.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe('SUCCEEDED');
  });
  it.each([
    JOB_QUEUES.artifactManifestIssued,
    JOB_QUEUES.quoteStatusChanged,
    JOB_QUEUES.mobileSyncCleanup,
    JOB_QUEUES.mobileEvidenceCleanup,
  ])(
    'keeps financial/security/cleanup queue %s running while suspended',
    async (queue) => {
      const job = await enqueue(tenant, queue),
        process = processor(queue);
      await change(tenant, 'SUSPENDED');
      await app.get(BackgroundJobWorker).tick();
      expect(process).toHaveBeenCalledTimes(1);
      expect(
        (await admin.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }))
          .status,
      ).toBe('SUCCEEDED');
    },
  );
  it('reactivation cannot execute operational jobs for an ineligible canonical subscription', async () => {
    const job = await enqueue(tenant),
      process = processor(JOB_QUEUES.artifactRender);
    await change(tenant, 'SUSPENDED');
    await app.get(BackgroundJobWorker).tick();
    await admin.organizationSubscription.update({
      where: { id: tenant.subscriptionId },
      data: {
        status: 'EXPIRED',
        billingAnchorAt: new Date(Date.now() - 30 * 86400000),
        currentPeriodStart: new Date(Date.now() - 30 * 86400000),
        currentPeriodEnd: new Date(Date.now() - 86400000),
      },
    });
    await change(tenant, 'ACTIVE', 'RESOLVED');
    await app.get(BackgroundJobWorker).tick();
    expect(process).not.toHaveBeenCalled();
    expect(
      await admin.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      status: 'PENDING',
      attempts: 0,
      lastError: 'SUBSCRIPTION_NOT_ACTIVE',
    });
  });
  it('allows a job admitted before suspension to finish and blocks subsequent admissions', async () => {
    const job = await enqueue(tenant);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((r) => {
        entered = r;
      }),
      barrier = new Promise<void>((r) => {
        release = r;
      });
    const process = processor(JOB_QUEUES.artifactRender, async () => {
      entered();
      await barrier;
    });
    const tick = app.get(BackgroundJobWorker).tick();
    await started;
    await change(tenant, 'SUSPENDED');
    await auth(http().get('/api/v1/nx03-test'), tenant.pair.accessToken).expect(
      403,
    );
    release();
    await tick;
    expect(process).toHaveBeenCalledTimes(1);
    expect(
      (await admin.backgroundJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe('SUCCEEDED');
    await enqueue(tenant);
    await app.get(BackgroundJobWorker).tick();
    expect(process).toHaveBeenCalledTimes(1);
  });
  it('checks a pre-issued signed upload after signature authentication and before accepting data', async () => {
    const config = app.get<StorageConfig>(STORAGE_CONFIG);
    const grant = uploadGrant(config, {
      bucket: config.bucket,
      objectKey: `operation-photos/${tenant.id}/${randomUUID()}.png`,
      operation: 'upload',
      expiresInSeconds: 300,
      mimeType: 'image/png',
    });
    await change(tenant, 'SUSPENDED');
    const url = new URL(grant.url);
    const response = await http()
      .put(url.pathname + url.search)
      .set('content-type', 'image/png')
      .send(Buffer.from('not-an-image'))
      .expect(403);
    expect(response.body).toMatchObject({
      error: { code: 'ORGANIZATION_SUSPENDED' },
    });
    url.searchParams.set('signature', '0'.repeat(64));
    const invalid = await http()
      .put(url.pathname + url.search)
      .send({})
      .expect(403);
    expect(invalid.body).toMatchObject({
      error: { code: 'STORAGE_SIGNATURE_INVALID' },
    });
  });
  it('does not emit realtime tenant data into sockets established before suspension', async () => {
    await change(tenant, 'SUSPENDED');
    expect(
      await app
        .get(NotificationGateway)
        .emitToUser(tenant.ownerId, 'nx03:test', { test: true }, tenant.id),
    ).toBe(false);
  });
  it('does not reactivate retained, canceled or purging organizations', async () => {
    await admin.organization.update({
      where: { id: tenant.id },
      data: { status: 'CANCELLED' },
    });
    expect((await change(tenant, 'ACTIVE', 'RESOLVED')).status).toBe(409);
    await admin.organization.update({
      where: { id: tenant.id },
      data: { status: 'SUSPENDED', dataPurgeStartedAt: new Date() },
    });
    expect((await change(tenant, 'ACTIVE', 'RESOLVED')).status).toBe(409);
  });
});
