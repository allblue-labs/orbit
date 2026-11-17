import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { CATALOG_VERSION } from '../src/modules/subscription-plans/catalog/plan-catalog.types';
import { snapshotOf } from '../src/modules/subscription-plans/subscriptions/subscription.snapshot';
import { planDefinition } from '../src/modules/subscription-plans/catalog/plan-registry';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { HASH_PROVIDER, CRYPTO_PROVIDER } from '../src/providers';
import type { IHashProvider, ICryptoProvider } from '../src/contracts';
import { IdentityRepository } from '../src/modules/identity/infrastructure/identity.repository';
import { RegistrationRepository } from '../src/modules/identity/infrastructure/registration.repository';
import { SubscriptionProvisioningService } from '../src/modules/subscription-plans/subscriptions/subscription-provisioning.service';
import { TrialFingerprintService } from '../src/modules/subscription-plans/subscriptions/trial-fingerprint';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

const PASSWORD = 'Orbit#Canonical@2026';
const unwrap = <T>(response: request.Response) =>
  (response.body as { data: T }).data;
interface Organization {
  id: string;
  owner: { id: string; email: string };
  updatedAt: string;
  subscriptionStatus: string;
  subscription: {
    id: string;
    status: string;
    planCode: string;
    accessGranted: boolean;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    trialEndsAt: string | null;
    pendingChange: unknown;
    cancelAtPeriodEnd: boolean;
  };
  legacyBilling: { inconsistent: boolean };
  provisioning: {
    id: string;
    status: string;
    complete: boolean;
    ownerSetup: string;
  };
}
function document() {
  const base =
    Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('') +
    '0001';
  const digit = (value: string) => {
    const weights =
      value.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest =
      [...value].reduce((total, n, i) => total + Number(n) * weights[i]!, 0) %
      11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = `${base}${digit(base)}`;
  return `${first}${digit(first)}`;
}

describe('ORB-NX-02 canonical platform administration (HTTP / restricted PostgreSQL)', () => {
  const admin = adminPrisma();
  let app: INestApplication<App>;
  let runtime: Pool;
  let token: string;
  let actorId: string;
  let globalRoleId: string;
  let createdRole = false;
  const owners: string[] = [];
  const operations: string[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (req: request.Test, authToken = token) =>
    req.set('Authorization', `Bearer ${authToken}`);
  const input = (planKey = 'PROFESSIONAL') => {
    const suffix = randomUUID().slice(0, 8);
    return {
      owner: {
        email: `nx02.${suffix}@example.test`,
        firstName: 'Owner',
        lastName: 'Teste',
      },
      organizationName: `Canonical ${suffix}`,
      primarySegment: 'HVAC_R',
      planKey,
      primaryBusinessUnit: {
        legalName: `Canonical ${suffix} LTDA`,
        documentType: 'CNPJ',
        documentNumber: document(),
        city: 'Recife',
        street: 'Rua Teste',
        stateCode: 'PE',
      },
    };
  };
  async function create(body = input(), key = randomUUID(), status = 201) {
    owners.push(body.owner.email);
    const response = await auth(http().post('/api/v1/platform-admin/tenants'))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(status);
    const org = unwrap<Organization>(response);
    operations.push(org.provisioning.id);
    return { org, body, key };
  }
  const read = async (id: string) =>
    unwrap<Organization>(
      await auth(
        http().get(`/api/v1/platform-admin/organizations/${id}`),
      ).expect(200),
    );
  const resume = async (id: string, status = 200) =>
    unwrap<Organization>(
      await auth(
        http().post(`/api/v1/platform-admin/tenant-provisionings/${id}/resume`),
      ).expect(status),
    );

  beforeAll(async () => {
    if (
      !process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_') ||
      !process.env.APP_DATABASE_URL
    )
      throw new Error('Disposable database required');
    const module = await Test.createTestingModule({
      imports: [AppModule],
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
    let role = await admin.role.findFirst({
      where: { organizationId: null, key: 'PLATFORM_ADMIN', deletedAt: null },
    });
    if (!role) {
      role = await admin.role.create({
        data: {
          key: 'PLATFORM_ADMIN',
          name: 'Platform Administrator',
          permissions: ['*', 'platform.admin'],
          allowedSurfaces: ['WEB', 'MOBILE'],
          isSystem: true,
        },
      });
      createdRole = true;
    }
    globalRoleId = role.id;
    const email = `nx02.admin.${randomUUID()}@example.test`;
    const actor = await admin.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Admin',
        lastName: 'Teste',
        displayName: 'Admin Teste',
        status: 'ACTIVE',
        credential: {
          create: {
            passwordHash: await app
              .get<IHashProvider>(HASH_PROVIDER)
              .hash(PASSWORD),
          },
        },
        platformRoleAssignments: { create: { roleId: role.id } },
      },
    });
    actorId = actor.id;
    token = unwrap<{ accessToken: string }>(
      await http()
        .post('/api/v1/identity/login')
        .send({ email, password: PASSWORD, client: 'WEB' })
        .expect(200),
    ).accessToken;
  });
  afterAll(async () => {
    jest.restoreAllMocks();
    await runtime?.end();
    await app?.close();
    await admin.platformTenantProvisioning.deleteMany({
      where: { actorUserId: actorId },
    });
    const users = await admin.user.findMany({
      where: { email: { in: owners } },
      select: { id: true },
    });
    await admin.organization.deleteMany({
      where: { ownerUserId: { in: users.map((user) => user.id) } },
    });
    await admin.user.deleteMany({
      where: { id: { in: [...users.map((user) => user.id), actorId] } },
    });
    if (createdRole) await admin.role.delete({ where: { id: globalRoleId } });
    await disconnectAdminPrisma();
  });

  it('paid provisioning creates canonical pending access, owner bindings and setup outbox without an owner password', async () => {
    const { org } = await create();
    expect(org.subscription).toMatchObject({
      status: 'PENDING_PAYMENT',
      accessGranted: false,
      planCode: 'PROFESSIONAL',
    });
    expect(org.provisioning).toMatchObject({
      complete: true,
      ownerSetup: 'SETUP_LINK_QUEUED',
    });
    const row = await admin.organization.findUniqueOrThrow({
      where: { id: org.id },
    });
    expect(row.ownerUserId).toBe(org.owner.id);
    expect(
      await admin.organizationMembership.count({
        where: {
          organizationId: org.id,
          userId: org.owner.id,
          role: { key: 'OWNER' },
        },
      }),
    ).toBe(1);
    expect(
      await admin.businessUnitMembership.count({
        where: { organizationId: org.id, userId: org.owner.id },
      }),
    ).toBe(1);
    const mail = await admin.identityEmailDelivery.findFirstOrThrow({
      where: { userId: org.owner.id, purpose: 'PASSWORD_RESET' },
    });
    expect(mail.status).toBe('PENDING');
    const payload = JSON.parse(
      app.get<ICryptoProvider>(CRYPTO_PROVIDER).decrypt(mail.encryptedPayload!),
    ) as { token: string };
    expect(JSON.stringify(org)).not.toContain(payload.token);
    await http()
      .post('/api/v1/identity/password/reset')
      .send({ token: payload.token, password: PASSWORD })
      .expect(204);
    await http()
      .post('/api/v1/identity/password/reset')
      .send({ token: payload.token, password: PASSWORD })
      .expect(400);
    const access = unwrap<{ accessToken: string }>(
      await http()
        .post('/api/v1/identity/login')
        .send({ email: org.owner.email, password: PASSWORD, client: 'WEB' })
        .expect(200),
    );
    await auth(http().get('/api/v1/operations'), access.accessToken).expect(
      402,
    );
    await auth(
      http().get(
        `/api/v1/platform-admin/tenant-provisionings/${org.provisioning.id}`,
      ),
      access.accessToken,
    ).expect(403);
    await auth(
      http().post(
        `/api/v1/platform-admin/tenant-provisionings/${org.provisioning.id}/resume`,
      ),
      access.accessToken,
    ).expect(403);
    expect((await read(org.id)).provisioning.ownerSetup).toBe(
      'PASSWORD_CONFIGURED',
    );
    // Later recovery must still work when it deletes the original setup token.
    await http()
      .post('/api/v1/identity/password/forgot')
      .send({ email: org.owner.email })
      .expect(202);
    expect(
      await admin.passwordResetToken.count({ where: { userId: org.owner.id } }),
    ).toBe(1);
    expect(
      await admin.identityEmailDelivery.count({
        where: { userId: org.owner.id, purpose: 'PASSWORD_RESET' },
      }),
    ).toBe(2);
    expect((await read(org.id)).provisioning.ownerSetup).toBe(
      'PASSWORD_CONFIGURED',
    );
  });

  it('essential uses canonical 30-day eligibility and exposes trial separately from active paid contracts', async () => {
    const { org } = await create(input('ESSENTIAL'));
    expect(org.subscription).toMatchObject({
      status: 'TRIALING',
      accessGranted: true,
    });
    const stored = await admin.organizationSubscription.findUniqueOrThrow({
      where: { id: org.subscription.id },
    });
    expect(
      stored.trialEndsAt!.getTime() - stored.trialStartsAt!.getTime(),
    ).toBe(30 * 86400000);
  });
  it('creation rejects legacy financial activation and malformed nested owner input', async () => {
    const body = input();
    owners.push(body.owner.email);
    await auth(http().post('/api/v1/platform-admin/tenants'))
      .send({ ...body, subscriptionStatus: 'ACTIVE' })
      .expect(400);
    await auth(http().post('/api/v1/platform-admin/tenants'))
      .send({ ...body, owner: null })
      .expect(400);
    expect(
      await admin.user.count({ where: { normalizedEmail: body.owner.email } }),
    ).toBe(0);
  });

  it('consumed legal-document trial is not granted again by administrative creation', async () => {
    const original = await create(input('ESSENTIAL'));
    const next = input('ESSENTIAL');
    const fingerprint = app
      .get(TrialFingerprintService)
      .fingerprint(next.primaryBusinessUnit.documentNumber);
    await admin.subscriptionTrialGrant.create({
      data: {
        organizationId: original.org.id,
        planCode: 'ESSENTIAL',
        legalDocumentFingerprint: fingerprint,
        status: 'GRANTED',
        riskDecision: 'ALLOW',
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 30 * 86400000),
      },
    });
    const { org } = await create(next);
    expect(org.subscription).toMatchObject({
      status: 'PENDING_PAYMENT',
      accessGranted: false,
    });
    expect(
      await admin.subscriptionTrialGrant.count({
        where: { organizationId: org.id },
      }),
    ).toBe(0);
  });

  it('canonical transaction failure preserves tenant, rolls back trial and resumes without duplicating either', async () => {
    const service = app.get(SubscriptionProvisioningService);
    const original = service.provisionIn.bind(service);
    const spy = jest
      .spyOn(service, 'provisionIn')
      .mockImplementationOnce(async (tx, value) => {
        await original(tx, value);
        throw new Error('synthetic-after-subscription-write');
      });
    const { org, body, key } = await create(
      input('ESSENTIAL'),
      randomUUID(),
      202,
    );
    expect(org.provisioning.status).toBe('TENANT_CREATED');
    expect(
      await admin.organizationSubscription.count({
        where: { organizationId: org.id },
      }),
    ).toBe(0);
    expect(
      await admin.subscriptionTrialGrant.count({
        where: { organizationId: org.id },
      }),
    ).toBe(0);
    spy.mockRestore();
    const retried = await create(body, key);
    expect(retried.org.id).toBe(org.id);
    expect(retried.org.subscription.status).toBe('TRIALING');
    expect(
      await admin.organizationSubscription.count({
        where: { organizationId: org.id },
      }),
    ).toBe(1);
    expect(
      await admin.subscriptionTrialGrant.count({
        where: { organizationId: org.id },
      }),
    ).toBe(1);
    expect((await resume(org.provisioning.id)).id).toBe(org.id);
  });

  it('a failed initial transaction leaves a durable retry record without orphan owner or tenant', async () => {
    const repository = app.get(RegistrationRepository);
    const original = repository.register.bind(repository);
    const body = input();
    const key = randomUUID();
    owners.push(body.owner.email);
    const spy = jest
      .spyOn(repository, 'register')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('synthetic-after-owner-and-tenant-write');
      });
    await auth(http().post('/api/v1/platform-admin/tenants'))
      .set('Idempotency-Key', key)
      .send(body)
      .expect(500);
    expect(
      await admin.user.count({ where: { normalizedEmail: body.owner.email } }),
    ).toBe(0);
    spy.mockRestore();
    const recovered = await create(body, key);
    expect(recovered.org.provisioning.complete).toBe(true);
    expect(
      await admin.user.count({ where: { normalizedEmail: body.owner.email } }),
    ).toBe(1);
    expect(
      await admin.platformTenantProvisioning.count({
        where: { actorUserId: actorId, organizationId: recovered.org.id },
      }),
    ).toBe(1);
  });

  it('setup enqueue failure preserves canonical access state and resumes the existing operation', async () => {
    const identities = app.get(IdentityRepository);
    const original = identities.createPasswordReset.bind(identities);
    const spy = jest
      .spyOn(identities, 'createPasswordReset')
      .mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('synthetic-after-setup-token-and-outbox');
      });
    const { org } = await create(input(), randomUUID(), 202);
    expect(org.provisioning.status).toBe('SUBSCRIPTION_READY');
    expect(org.subscription.status).toBe('PENDING_PAYMENT');
    expect(
      await admin.passwordResetToken.count({ where: { userId: org.owner.id } }),
    ).toBe(0);
    expect(
      await admin.identityEmailDelivery.count({
        where: { userId: org.owner.id },
      }),
    ).toBe(0);
    spy.mockRestore();
    // A different verified global administrator may resume the canonical first-owner setup.
    const email = `nx02.second-admin.${randomUUID()}@example.test`;
    owners.push(email);
    await admin.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Second',
        lastName: 'Admin',
        displayName: 'Second Admin',
        status: 'ACTIVE',
        credential: {
          create: {
            passwordHash: await app
              .get<IHashProvider>(HASH_PROVIDER)
              .hash(PASSWORD),
          },
        },
        platformRoleAssignments: { create: { roleId: globalRoleId } },
      },
    });
    const secondToken = unwrap<{ accessToken: string }>(
      await http()
        .post('/api/v1/identity/login')
        .send({ email, password: PASSWORD, client: 'WEB' })
        .expect(200),
    ).accessToken;
    const result = unwrap<Organization>(
      await auth(
        http().post(
          `/api/v1/platform-admin/tenant-provisionings/${org.provisioning.id}/resume`,
        ),
        secondToken,
      ).expect(200),
    );
    expect(result.id).toBe(org.id);
    expect(result.provisioning.complete).toBe(true);
    expect(
      await admin.identityEmailDelivery.count({
        where: { userId: org.owner.id, purpose: 'PASSWORD_RESET' },
      }),
    ).toBe(1);
  });

  it('same request is idempotent under concurrent callers, and a changed body conflicts', async () => {
    const body = input();
    const key = randomUUID();
    owners.push(body.owner.email);
    const responses = await Promise.all(
      [1, 2, 3].map(() =>
        auth(http().post('/api/v1/platform-admin/tenants'))
          .set('Idempotency-Key', key)
          .send(body)
          .expect(201),
      ),
    );
    const orgs = responses.map((response) => unwrap<Organization>(response));
    operations.push(orgs[0]!.provisioning.id);
    expect(new Set(orgs.map((org) => org.id)).size).toBe(1);
    expect(
      await admin.organizationSubscription.count({
        where: { organizationId: orgs[0]!.id },
      }),
    ).toBe(1);
    expect(
      await admin.identityEmailDelivery.count({
        where: { userId: orgs[0]!.owner.id },
      }),
    ).toBe(1);
    await auth(http().post('/api/v1/platform-admin/tenants'))
      .set('Idempotency-Key', key)
      .send({ ...body, planKey: 'ESSENTIAL' })
      .expect(409);
    const replay = await create(body, key);
    expect(replay.org.id).toBe(orgs[0]!.id);
  });

  it('legacy clients can omit the idempotency header and provide a password without bypassing billing', async () => {
    const body = {
      ...input(),
      owner: { ...input().owner, password: PASSWORD },
    };
    owners.push(body.owner.email);
    const one = unwrap<Organization>(
      await auth(http().post('/api/v1/platform-admin/tenants'))
        .send(body)
        .expect(201),
    );
    const two = unwrap<Organization>(
      await auth(http().post('/api/v1/platform-admin/tenants'))
        .send(body)
        .expect(201),
    );
    expect(one.id).toBe(two.id);
    expect(one.subscription.accessGranted).toBe(false);
    expect(one.provisioning.ownerSetup).toBe('DIRECT_PASSWORD_DEPRECATED');
  });

  it.each([
    { subscriptionStatus: 'ACTIVE' },
    { planKey: 'ESSENTIAL' },
    { currentPeriodEnd: '2099-01-01T00:00:00Z' },
  ])(
    'PATCH cannot modify effective billing through legacy fields: %j',
    async (patch) => {
      const { org } = await create();
      const before = await admin.organizationSubscription.findUniqueOrThrow({
        where: { id: org.subscription.id },
      });
      await auth(http().patch(`/api/v1/platform-admin/organizations/${org.id}`))
        .send(patch)
        .expect(400);
      expect(
        await admin.organizationSubscription.findUniqueOrThrow({
          where: { id: org.subscription.id },
        }),
      ).toEqual(before);
    },
  );

  it('administrative metadata updates require version and do not change billing; suspension is not added', async () => {
    const { org } = await create();
    await auth(http().patch(`/api/v1/platform-admin/organizations/${org.id}`))
      .send({ displayName: 'Nome corrigido' })
      .expect(400);
    await auth(http().patch(`/api/v1/platform-admin/organizations/${org.id}`))
      .send({ displayName: 'Nome corrigido', expectedUpdatedAt: org.updatedAt })
      .expect(200);
    await auth(http().patch(`/api/v1/platform-admin/organizations/${org.id}`))
      .send({ displayName: 'Versão antiga', expectedUpdatedAt: org.updatedAt })
      .expect(409);
    await auth(http().patch(`/api/v1/platform-admin/organizations/${org.id}`))
      .send({ status: 'SUSPENDED' })
      .expect(400);
    expect((await read(org.id)).subscription.status).toBe('PENDING_PAYMENT');
  });

  it('projections ignore false legacy ACTIVE and distinguish scheduled, ended and unknown contracts', async () => {
    const { org } = await create();
    await admin.organization.update({
      where: { id: org.id },
      data: {
        subscriptionStatus: 'ACTIVE',
        currentPeriodEnd: new Date('2099-01-01'),
      },
    });
    const inspector = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const results = (await inspector.query(
        readFileSync(
          join(__dirname, '../scripts/audit-administrative-subscriptions.sql'),
          'utf8',
        ),
      )) as unknown as { rows: Record<string, unknown>[] }[];
      expect(
        results
          .flatMap((result) => result.rows)
          .some(
            (row) =>
              row.organization_id === org.id &&
              row.diagnosis === 'STORED_STATE_DIVERGENCE',
          ),
      ).toBe(true);
    } finally {
      await inspector.end();
    }
    expect(await read(org.id)).toMatchObject({
      subscriptionStatus: 'PENDING_PAYMENT',
      legacyBilling: { inconsistent: true },
    });
    await admin.organizationSubscription.update({
      where: { id: org.subscription.id },
      data: {
        status: 'ACTIVE',
        providerSubscriptionId: 'sub_synthetic',
        pendingPlanCode: 'ESSENTIAL',
        pendingBillingInterval: 'MONTHLY',
        pendingCatalogVersion: CATALOG_VERSION,
        pendingEntitlementsSnapshot: snapshotOf(
          planDefinition('ESSENTIAL'),
        ) as unknown as Prisma.InputJsonValue,
        pendingEffectiveAt: new Date(Date.now() + 86400000),
        cancelAtPeriodEnd: true,
      },
    });
    const active = await read(org.id);
    expect(active.subscription).toMatchObject({
      status: 'ACTIVE',
      planCode: 'PROFESSIONAL',
      cancelAtPeriodEnd: true,
      pendingChange: { planCode: 'ESSENTIAL' },
    });
    const overview = unwrap<{
      activeSubscriptions: number;
      pendingSubscriptions: number;
      validTrials: number;
      scheduledPlanChanges: number;
      scheduledCancellations: number;
      unknownLegacySubscriptions: number;
    }>(await auth(http().get('/api/v1/platform-admin/overview')).expect(200));
    expect(overview.activeSubscriptions).toBeGreaterThanOrEqual(1);
    expect(overview.pendingSubscriptions).toBeGreaterThan(0);
    expect(overview.validTrials).toBeGreaterThan(0);
    expect(overview.scheduledPlanChanges).toBeGreaterThanOrEqual(1);
    expect(overview.scheduledCancellations).toBeGreaterThanOrEqual(1);
    await admin.organizationSubscription.update({
      where: { id: org.subscription.id },
      data: {
        status: 'CANCELED',
        endedAt: new Date(),
        pendingPlanCode: null,
        pendingBillingInterval: null,
        pendingCatalogVersion: null,
        pendingEntitlementsSnapshot: Prisma.DbNull,
        pendingEffectiveAt: null,
        cancelAtPeriodEnd: false,
      },
    });
    expect((await read(org.id)).subscription.status).toBe('CANCELED');
    await admin.organizationSubscription.delete({
      where: { id: org.subscription.id },
    });
    expect((await read(org.id)).subscription).toMatchObject({
      source: 'UNKNOWN_LEGACY',
      status: 'UNKNOWN',
      accessGranted: false,
    });
  });

  it('keeps ORB-NX-01 authority/RLS and records verified operator, intent, correlation and confirmed/pending results', async () => {
    const { org } = await create();
    const client = await runtime.connect();
    try {
      const role = await client.query(
        'SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user',
      );
      expect(role.rows).toEqual([
        { name: 'orbit_app', rolsuper: false, rolbypassrls: false },
      ]);
      expect(
        (
          await client.query(
            "SELECT has_table_privilege(current_user,'platform_tenant_provisionings','DELETE') AS allowed",
          )
        ).rows,
      ).toEqual([{ allowed: false }]);
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.user_id',$1,true), set_config('app.organization_id',$2,true), set_config('app.is_platform_admin','false',true)",
        [org.owner.id, org.id],
      );
      expect(
        (await client.query('SELECT id FROM platform_tenant_provisionings'))
          .rows,
      ).toEqual([]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const audits = await admin.auditLog.findMany({
      where: { organizationId: org.id, action: 'PLATFORM_TENANT_PROVISIONING' },
    });
    expect(
      audits.map((audit) => (audit.metadata as { result: string }).result),
    ).toEqual(
      expect.arrayContaining([
        'TENANT_CREATED',
        'SUBSCRIPTION_READY',
        'CONFIRMED',
      ]),
    );
    for (const audit of audits) {
      expect(audit.userId).toBe(actorId);
      expect(audit.requestId).toBeTruthy();
      expect(audit.before).not.toBeNull();
      expect(audit.after).not.toBeNull();
      const metadata = audit.metadata as {
        grantIds: string[];
        correlationId: string;
      };
      expect(Array.isArray(metadata.grantIds)).toBe(true);
      expect(metadata.grantIds.length).toBeGreaterThan(0);
      expect(typeof metadata.correlationId).toBe('string');
      expect(audit.metadata).toMatchObject({
        authoritySource: 'PLATFORM_ROLE_ASSIGNMENT',
      });
    }
  });
});
