import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { BILLING_PROVIDER } from '../src/modules/billing/billing.types';
import { planDefinition } from '../src/modules/subscription-plans/catalog/plan-registry';
import { snapshotOf } from '../src/modules/subscription-plans/subscriptions/subscription.snapshot';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(90_000);
const prefix = '/api/v1/corporate-admin';
const technicalId = randomUUID();
const administratorId = randomUUID();
function credential(
  keyId: string,
  capabilities: string[],
  principalId = technicalId,
) {
  const secret = randomBytes(32).toString('base64url');
  return {
    token: ['orbit-ca1', 'local', keyId, secret].join('.'),
    record: {
      principalId,
      keyId,
      capabilities,
      environment: 'local',
      revoked: false,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      secretSha256: createHash('sha256')
        .update(['orbit-corporate-admin.v1', 'local', keyId, secret].join('\0'))
        .digest('hex'),
    },
  };
}
const reader = credential('commercial-reader', [
  'plans:read',
  'subscriptions:read',
  'trials:read',
]);
const other = credential(
  'commercial-other',
  ['subscriptions:read'],
  randomUUID(),
);
const review = credential('commercial-review', ['subscriptions:change-plan']);
const keep = credential('commercial-keep', ['subscriptions:keep']);
const stopSchedule = credential('commercial-unschedule', [
  'subscriptions:cancel-scheduled-change',
]);
const startTrial = credential('commercial-trial', ['trials:manage']);
const legacy = credential('legacy', ['connection:read']);
const documents = ['78937541000163', '90716421000191'];
const never = jest.fn(() => {
  throw new Error('Provider unexpectedly contacted');
});
const provider = {
  name: 'STRIPE',
  mode: 'TEST',
  isEnabled: () => true,
  createCheckoutSession: never,
  createCustomer: never,
  expireCheckoutSession: never,
  retrieveSubscription: never,
  retrieveCheckoutSession: never,
  retrieveInvoice: never,
  changePlan: never,
  beginMonthlyUpgrade: never,
  refundAndCancel: never,
  setCancelAtPeriodEnd: never,
  cancelScheduledPlanChange: never,
};

const snapshot = (code: 'ESSENTIAL' | 'PROFESSIONAL') =>
  snapshotOf(planDefinition(code)) as unknown as Prisma.InputJsonValue;

type Receipt = {
  id: string;
  result: string;
  ticketId: string | null;
  subscriptionVersion: number;
};
function data<T = Receipt>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

describe('ADM-04.A corporate commercial administration', () => {
  let app: INestApplication<App>;
  let essential: { id: string; catalogVersion: number };
  let professional: { id: string; catalogVersion: number };
  let keeper: Awaited<ReturnType<typeof fixture>>;
  let scheduled: Awaited<ReturnType<typeof fixture>>;
  let paid: Awaited<ReturnType<typeof fixture>>;
  let pending: Awaited<ReturnType<typeof fixture>>;
  let duplicate: Awaited<ReturnType<typeof fixture>>;
  let privatePlanId: string;
  const http = () => request(app.getHttpServer());
  const path = (id: string) => '/organizations/' + id;
  const auth = (call: request.Test, credential: { token: string }) =>
    call.set('Authorization', 'Bearer ' + credential.token);
  const get = (route: string, grant = reader) =>
    auth(http().get(prefix + route), grant);
  const write = (
    route: string,
    grant: { token: string },
    input: object,
    key = randomUUID(),
  ) =>
    auth(http().post(prefix + route), grant)
      .set('X-Nexus-Administrator-Id', administratorId)
      .set('Idempotency-Key', key)
      .send(input);
  const version = (fixed: Awaited<ReturnType<typeof fixture>>) => ({
    expectedSubscriptionId: fixed.subscription.id,
    expectedVersion: fixed.subscription.version,
    reason: 'CUSTOMER_REQUEST',
  });
  async function fixture(
    label: string,
    status: string,
    extra: Prisma.OrganizationSubscriptionUncheckedUpdateInput = {},
    document = documents[0]!,
  ) {
    const db = adminPrisma();
    const email = label + '-' + randomUUID() + '@example.test';
    const owner = await db.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Responsável',
        lastName: 'Sintético',
        displayName: 'Titular sintético',
        status: 'ACTIVE',
      },
    });
    const organization = await db.organization.create({
      data: {
        ownerUserId: owner.id,
        planId: professional.id,
        slug: label + '-' + randomUUID(),
        displayName: 'Empresa sintética',
        primarySegment: 'HVAC_R',
        status: 'ACTIVE',
      },
    });
    await db.businessUnit.create({
      data: {
        organizationId: organization.id,
        slug: 'matriz',
        legalName: 'Empresa sintética',
        isPrimary: true,
        documentType: 'CNPJ',
        documentNumber: document,
        city: 'Recife',
        street: 'Rua de teste',
        district: 'Centro',
      },
    });
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 7 * 86_400_000);
    let subscription = await db.organizationSubscription.create({
      data: {
        organizationId: organization.id,
        planCode: 'PROFESSIONAL',
        catalogVersion: professional.catalogVersion,
        entitlementsSnapshot: snapshot('PROFESSIONAL'),
        billingInterval: 'MONTHLY',
        status,
        billingAnchorAt: from,
        currentPeriodStart: from,
        currentPeriodEnd: to,
        startedAt: from,
      },
    });
    if (Object.keys(extra).length)
      subscription = await db.organizationSubscription.update({
        where: { id: subscription.id },
        data: extra,
      });
    return { organization, subscription };
  }

  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error('Disposable database required');
    const previous = { ...process.env };
    delete process.env.ORBIT_DEPLOYMENT;
    process.env.ORBIT_CORPORATE_ADMIN_ENABLED = 'true';
    process.env.ORBIT_CORPORATE_ADMIN_CREDENTIALS = JSON.stringify(
      [reader, other, review, keep, stopSchedule, startTrial, legacy].map(
        (item) => item.record,
      ),
    );
    try {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(BILLING_PROVIDER)
        .useValue(provider)
        .compile();
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
    } finally {
      for (const key of [
        'ORBIT_DEPLOYMENT',
        'ORBIT_CORPORATE_ADMIN_ENABLED',
        'ORBIT_CORPORATE_ADMIN_CREDENTIALS',
      ]) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
    const db = adminPrisma();
    essential = await db.plan.findUniqueOrThrow({
      where: { key: 'ESSENTIAL' },
    });
    professional = await db.plan.findUniqueOrThrow({
      where: { key: 'PROFESSIONAL' },
    });
    keeper = await fixture('adm04-keep', 'ACTIVE', { cancelAtPeriodEnd: true });
    scheduled = await fixture('adm04-scheduled', 'ACTIVE', {
      pendingPlanCode: 'ESSENTIAL',
      pendingBillingInterval: 'MONTHLY',
      pendingCatalogVersion: essential.catalogVersion,
      pendingEntitlementsSnapshot: snapshot('ESSENTIAL'),
      pendingEffectiveAt: new Date(Date.now() + 86_400_000),
    });
    paid = await fixture('adm04-provider', 'ACTIVE', {
      cancelAtPeriodEnd: true,
      provider: 'STRIPE',
      providerSubscriptionId: 'sub_synthetic_private',
      providerCustomerId: 'cus_synthetic_private',
      providerPriceId: 'price_synthetic_private',
    });
    pending = await fixture(
      'adm04-pending',
      'PENDING_PAYMENT',
      {},
      documents[1],
    );
    duplicate = await fixture(
      'adm04-duplicate',
      'PENDING_PAYMENT',
      {},
      documents[1],
    );
    const base = await db.plan.findUniqueOrThrow({
      where: { id: essential.id },
    });
    const commercial = base.commercial as Prisma.JsonObject & {
      prices: Record<string, Prisma.JsonObject>;
    };
    const privateOffer = await db.plan.create({
      data: {
        key: 'ADM04_PRIVATE',
        name: 'Plano privado sintético',
        catalogTenantId: keeper.organization.id,
        commercial: {
          ...commercial,
          prices: {
            ...commercial.prices,
            MONTHLY: {
              ...commercial.prices.MONTHLY,
              stripePriceId: 'price_synthetic_catalog_private',
            },
          },
        },
      },
    });
    privatePlanId = privateOffer.id;
  });

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('scopes offers and exposes canonical prices, entitlements and payment evidence independently', async () => {
    await get('/plans', legacy).expect(403);
    const catalog = await get('/plans').expect(200);
    expect(catalog.text).not.toContain(privatePlanId);
    const byCode = await get('/plans/ESSENTIAL').expect(200);
    expect(data(byCode)).toMatchObject({
      id: essential.id,
      code: 'ESSENTIAL',
      currency: 'BRL',
      prices: { MONTHLY: { amountMinor: expect.any(Number) as unknown } },
    });
    expect(data(await get('/plans/' + essential.id).expect(200))).toEqual(
      data(byCode),
    );
    await get('/plans/' + privatePlanId)
      .query({ organizationId: paid.organization.id })
      .expect(404);
    const scoped = await get('/plans/' + privatePlanId)
      .query({ organizationId: keeper.organization.id })
      .expect(200);
    expect(data(scoped)).toMatchObject({
      id: privatePlanId,
      checkoutIntervals: expect.arrayContaining(['MONTHLY']) as unknown,
    });
    expect(scoped.text).not.toContain('price_synthetic_catalog_private');
    const subscription = await get(
      path(paid.organization.id) + '/subscription',
    ).expect(200);
    expect(data(subscription)).toMatchObject({
      subscription: {
        persistedStatus: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        catalogVersion: professional.catalogVersion,
        providerManaged: true,
      },
      payment: { source: 'LOCAL_BILLING_RECORDS', latestInvoice: null },
      entitlements: { planCode: 'PROFESSIONAL', accessGranted: true },
      corporateActions: {
        cancel: 'CUSTOMER_CONFIRMATION_REQUIRED',
        keep: 'PROVIDER_FLOW_REQUIRED',
      },
    });
    expect(subscription.text).not.toMatch(
      /sub_synthetic|cus_synthetic|price_synthetic/,
    );
    await get(path(randomUUID()) + '/subscription').expect(404);
    expect(never).not.toHaveBeenCalled();
  });

  it('records an eligible one-time trial atomically, with stable replay and duplicate prevention', async () => {
    const id = pending.organization.id;
    expect(data(await get(path(id) + '/trial').expect(200))).toMatchObject({
      canStart: true,
      history: [],
      effectiveStatus: 'PENDING_PAYMENT',
    });
    const route = path(id) + '/trial/start';
    const command = {
      ...version(pending),
      planCode: 'ESSENTIAL',
      expectedCatalogVersion: essential.catalogVersion,
    };
    await write(route, reader, command).expect(403);
    await write(route, startTrial, {
      ...command,
      expectedCatalogVersion: essential.catalogVersion + 1,
    }).expect(409);
    const key = randomUUID();
    const [a, b] = await Promise.all([
      write(route, startTrial, command, key).expect(200),
      write(route, startTrial, command, key).expect(200),
    ]);
    expect(data(a).id).toBe(data(b).id);
    expect(data(a)).toMatchObject({
      result: 'TRIAL_STARTED',
      subscriptionVersion: pending.subscription.version + 1,
    });
    const mismatch = await write(
      route,
      startTrial,
      { ...command, reason: 'ADMINISTRATIVE' },
      key,
    ).expect(409);
    expect(mismatch.body).toMatchObject({
      error: { code: 'IDEMPOTENCY_MISMATCH' },
    });
    await write(path(duplicate.organization.id) + '/trial/start', startTrial, {
      ...command,
      ...version(duplicate),
    }).expect(409);
    const history = await get(path(id) + '/trial').expect(200);
    expect(data(history)).toMatchObject({
      canStart: false,
      history: [{ status: 'GRANTED', planCode: 'ESSENTIAL' }],
      effectiveStatus: 'TRIALING',
    });
    expect(history.text).not.toContain(documents[1]);
    const db = adminPrisma();
    expect(
      await db.subscriptionTrialGrant.count({
        where: { organizationId: { in: [id, duplicate.organization.id] } },
      }),
    ).toBe(1);
    expect(
      await db.billingCheckoutAttempt.count({ where: { organizationId: id } }),
    ).toBe(0);
    const op = await get(
      path(id) + '/subscription/operations/' + data(a).id,
    ).expect(200);
    expect(data(op)).toMatchObject({ id: data(a).id, result: 'TRIAL_STARTED' });
    await get(
      path(id) + '/subscription/operations/' + data(a).id,
      other,
    ).expect(404);
    expect(never).not.toHaveBeenCalled();
  });

  it('records local plan review without changing price, subscription or entitlements', async () => {
    const id = keeper.organization.id;
    const route = path(id) + '/subscription/change-plan';
    const command = {
      ...version(keeper),
      planCode: 'ESSENTIAL',
      expectedCatalogVersion: essential.catalogVersion,
    };
    await write(route, review, {
      ...command,
      acknowledgeImmediateCharge: true,
    }).expect(400);
    const key = randomUUID();
    const first = data(await write(route, review, command, key).expect(202));
    expect(first).toMatchObject({
      result: 'AWAITING_REVIEW',
      subscriptionVersion: keeper.subscription.version,
    });
    const ticket = await adminPrisma().billingSupportTicket.findUniqueOrThrow({
      where: { id: first.ticketId! },
    });
    expect(ticket).toMatchObject({
      requestedBy: null,
      targetPlanCode: 'ESSENTIAL',
      status: 'OPEN',
    });
    expect(
      data(await write(route, review, command, key).expect(202)),
    ).toMatchObject({ id: first.id, ticketId: first.ticketId, replayed: true });
    expect(
      data(
        await get(path(id) + '/subscription/operations/' + first.id).expect(
          200,
        ),
      ),
    ).toMatchObject({ reviewStatus: 'OPEN' });
    const before = await adminPrisma().organizationSubscription.findUnique({
      where: { id: keeper.subscription.id },
    });
    expect(before).toEqual(keeper.subscription);
    await write(
      path(paid.organization.id) + '/subscription/change-plan',
      review,
      { ...command, ...version(paid) },
    ).expect(409);
    expect(never).not.toHaveBeenCalled();
  });

  it('keeps local renewal and removes a scheduled change with independent grants and guarded versions', async () => {
    const local = path(keeper.organization.id) + '/subscription/keep';
    const cancelSchedule =
      path(scheduled.organization.id) + '/subscription/cancel-scheduled-change';
    await write(local, review, version(keeper)).expect(403);
    await write(cancelSchedule, keep, version(scheduled)).expect(403);
    await auth(http().post(prefix + local), keep)
      .set('Idempotency-Key', randomUUID())
      .send(version(keeper))
      .expect(400);
    await write(
      path(paid.organization.id) + '/subscription/keep',
      keep,
      version(paid),
    ).expect(409);
    await write(
      path(paid.organization.id) + '/subscription/cancel',
      keep,
      version(paid),
    ).expect(404);
    const key = randomUUID();
    const db = adminPrisma();
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM organization_subscriptions
          WHERE id = ${keeper.subscription.id}::uuid FOR UPDATE`;
        const busy = await write(local, keep, version(keeper), key).expect(503);
        expect(busy.body).toMatchObject({
          error: { code: 'SERVICE_UNAVAILABLE' },
        });
      },
      { timeout: 15_000 },
    );
    const result = data(
      await write(local, keep, version(keeper), key).expect(200),
    );
    expect(result).toMatchObject({
      result: 'APPLIED',
      subscriptionVersion: keeper.subscription.version + 1,
    });
    await write(local, keep, version(keeper)).expect(409);
    expect(
      data(
        await write(cancelSchedule, stopSchedule, version(scheduled)).expect(
          200,
        ),
      ),
    ).toMatchObject({ result: 'APPLIED' });
    expect(
      await db.organizationSubscription.findUnique({
        where: { id: keeper.subscription.id },
      }),
    ).toMatchObject({
      cancelAtPeriodEnd: false,
      entitlementsSnapshot: keeper.subscription.entitlementsSnapshot,
    });
    expect(
      await db.organizationSubscription.findUnique({
        where: { id: scheduled.subscription.id },
      }),
    ).toMatchObject({
      pendingPlanCode: null,
      planCode: scheduled.subscription.planCode,
      entitlementsSnapshot: scheduled.subscription.entitlementsSnapshot,
    });
    expect(
      await db.organizationSubscription.findUnique({
        where: { id: paid.subscription.id },
      }),
    ).toEqual(paid.subscription);
    const audit = await db.auditLog.findFirst({
      where: { entityId: result.id, action: 'CORPORATE_COMMERCIAL_RESULT' },
    });
    expect(audit).toMatchObject({
      userId: null,
      metadata: {
        declaredNexusAdministratorId: administratorId,
        technicalPrincipalId: technicalId,
        reason: 'CUSTOMER_REQUEST',
        result: 'APPLIED',
      },
    });
    expect(never).not.toHaveBeenCalled();
  });

  it('rolls back the command with its receipt if the completion audit cannot be persisted', async () => {
    const item = await fixture('adm04-rollback', 'ACTIVE', {
      cancelAtPeriodEnd: true,
    });
    const db = adminPrisma();
    const trace = randomUUID();
    const key = randomUUID();
    await db.$executeRawUnsafe(
      "CREATE FUNCTION public.adm04a_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$",
    );
    try {
      await db.$executeRawUnsafe(`CREATE TRIGGER adm04a_test_audit_failure BEFORE INSERT ON public.audit_logs
        FOR EACH ROW WHEN (NEW.request_id = '${trace}' AND NEW.metadata->>'result' = 'APPLIED')
        EXECUTE FUNCTION public.adm04a_test_audit_failure()`);
      await write(
        path(item.organization.id) + '/subscription/keep',
        keep,
        version(item),
        key,
      )
        .set('X-Correlation-Id', trace)
        .expect(500);
      expect(
        await db.organizationSubscription.findUnique({
          where: { id: item.subscription.id },
        }),
      ).toEqual(item.subscription);
      expect(
        await db.corporateCommercialCommand.count({
          where: { organizationId: item.organization.id },
        }),
      ).toBe(0);
      expect(
        await db.auditLog.findMany({ where: { requestId: trace } }),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            metadata: expect.objectContaining({ result: 'STARTED' }) as unknown,
          }),
          expect.objectContaining({
            metadata: expect.objectContaining({
              result: 'UNCONFIRMED',
            }) as unknown,
          }),
        ]),
      );
    } finally {
      await db.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS adm04a_test_audit_failure ON public.audit_logs',
      );
      await db.$executeRawUnsafe(
        'DROP FUNCTION public.adm04a_test_audit_failure()',
      );
    }
    await write(
      path(item.organization.id) + '/subscription/keep',
      keep,
      version(item),
      key,
    ).expect(200);
    expect(never).not.toHaveBeenCalled();
  });
});
