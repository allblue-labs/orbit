import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { RequestContext, RequestContextStorage } from '../src/context';
import { RlsTransaction } from '../src/database';
import { BILLING_PROVIDER } from '../src/modules/billing/billing.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(90_000);
const root = '/api/v1/corporate-admin/analytics/';
const db = adminPrisma();
const principal = randomUUID();
const credentials = {
  analytics: [
    'analytics:revenue:read',
    'analytics:lifecycle:read',
    'analytics:trials:read',
    'analytics:delinquency:read',
  ],
  revenue: ['analytics:revenue:read'],
  finance: ['finance:overview:read', 'subscriptions:read'],
};
type Credential = keyof typeof credentials;
const secrets = {
  analytics: randomBytes(32).toString('base64url'),
  revenue: randomBytes(32).toString('base64url'),
  finance: randomBytes(32).toString('base64url'),
};
const providerLookup = jest.fn(() => {
  throw new Error('Unexpected Stripe access from analytics');
});
const scope = { mode: 'TEST', currency: 'BRL' };
const recurringPlan = 'ADM07_TEST_PLAN';
const revenueScope = { ...scope, planCode: recurringPlan };
const period = { ...scope, from: '2007-01-01', to: '2007-04-01' };
const date = (value: string) => new Date(value + 'T00:00:00.000Z');
const day = 86_400_000;
function data(response: request.Response): unknown {
  return (response.body as { data: unknown }).data;
}

async function contract(
  options: {
    mode?: 'TEST' | 'LIVE';
    currency?: string;
    months?: 1 | 6 | 12;
    gross?: number;
    discount?: { scaledMinor: number; endsAt: string | null } | null;
    paid?: boolean;
    missing?: boolean;
    suspended?: boolean;
    planCode?: string;
  } = {},
) {
  const identifier = randomUUID();
  const email = 'analytics-' + identifier + '@example.test';
  const mode = options.mode ?? 'TEST';
  const months = options.months ?? 1;
  const plan = await db.plan.findUniqueOrThrow({
    where: { key: 'PROFESSIONAL' },
  });
  const owner = await db.user.create({
    data: {
      email,
      normalizedEmail: email,
      firstName: 'Pessoa',
      lastName: 'Teste',
      displayName: 'Pessoa Teste',
      status: 'ACTIVE',
    },
  });
  const org = await db.organization.create({
    data: {
      ownerUserId: owner.id,
      planId: plan.id,
      slug: 'analytics-' + identifier,
      displayName: 'Organização sintética',
      primarySegment: 'HVAC_R',
      status: options.suspended ? 'SUSPENDED' : 'ACTIVE',
    },
  });
  const customer = await db.billingCustomer.create({
    data: {
      organizationId: org.id,
      provider: 'STRIPE',
      mode,
      providerCustomerId: 'cus_' + identifier,
    },
  });
  const now = Date.now();
  const start = new Date(now - 2 * day);
  const end = new Date(now + 20 * day);
  const price = 'price_' + identifier;
  const subscription = await db.organizationSubscription.create({
    data: {
      organizationId: org.id,
      status: 'ACTIVE',
      catalogVersion: plan.catalogVersion,
      planCode: options.planCode ?? 'PROFESSIONAL',
      entitlementsSnapshot: {},
      billingInterval:
        months === 1 ? 'MONTHLY' : months === 6 ? 'SEMIANNUAL' : 'ANNUAL',
      billingAnchorAt: start,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      startedAt: date('2006-01-01'),
      provider: 'STRIPE',
      providerPriceId: price,
      providerCustomerId: customer.providerCustomerId,
      providerSubscriptionId: 'sub_' + identifier,
      recurringObservation: options.missing
        ? undefined
        : {
            mode,
            currency: options.currency ?? 'brl',
            intervalMonths: months,
            providerPriceId: price,
            periodStart: start.toISOString(),
            periodEnd: end.toISOString(),
            observedAt: new Date(now - day).toISOString(),
            grossPeriodMinor: options.gross ?? 12_000,
            paid: options.paid ?? true,
            discount:
              options.discount === undefined
                ? { scaledMinor: 0, endsAt: null }
                : options.discount,
          },
    },
  });
  return { org, subscription, mode };
}
type Contract = Awaited<ReturnType<typeof contract>>;

async function invoice(
  { org, subscription, mode }: Contract,
  eventDate: string,
  options: Partial<Prisma.BillingInvoiceUncheckedCreateInput> = {},
) {
  const issued = date(eventDate);
  return db.billingInvoice.create({
    data: {
      organizationId: org.id,
      subscriptionId: subscription.id,
      mode,
      provider: 'STRIPE',
      providerInvoiceId: 'in_' + randomUUID(),
      currency: 'brl',
      status: 'OPEN',
      totalMinor: 3000,
      subtotalMinor: 3000,
      discountMinor: 0,
      taxMinor: 0,
      amountDueMinor: 3000,
      amountRemainingMinor: 3000,
      amountPaidMinor: 0,
      creditNotesMinor: 0,
      attempted: true,
      attemptCount: 1,
      planCodeAtIssue: 'PROFESSIONAL',
      collectionMethod: 'charge_automatically',
      periodStart: issued,
      periodEnd: new Date(issued.getTime() + 30 * day),
      providerObservedAt: new Date(),
      providerCreatedAt: issued,
      finalizedAt: issued,
      ...options,
    },
  });
}

function payment(dt: string) {
  const evidence = {
    amountMinor: 3000,
    currency: 'brl',
    invoicePaymentId: 'inpay_' + randomUUID(),
    paymentIntentId: 'pi_' + randomUUID(),
    confirmedAt: date(dt).toISOString(),
  };
  return {
    status: 'PAID',
    paidAt: date(dt),
    amountPaidMinor: 3000,
    amountRemainingMinor: 0,
    paymentEvidence: [evidence, evidence],
  };
}

function trial({ org }: Contract, from: string, to: string) {
  return db.subscriptionTrialGrant.create({
    data: {
      organizationId: org.id,
      planCode: 'ESSENTIAL',
      startsAt: date(from),
      endsAt: date(to),
      status: 'GRANTED',
      riskDecision: 'ALLOW',
      legalDocumentFingerprint: randomBytes(32).toString('hex'),
    },
  });
}

describe('ADM-07.R.A commercial analytics (PostgreSQL)', () => {
  let app: INestApplication<App>;
  const get = (path: string, filters: object, key: Credential = 'analytics') =>
    request(app.getHttpServer())
      .get(root + path)
      .query(filters)
      .set(
        'Authorization',
        'Bearer orbit-ca1.local.' + key + '.' + secrets[key],
      );

  beforeAll(async () => {
    if (!process.env.ORBIT_E2E_DATABASE?.startsWith('orbit_e2e_'))
      throw new Error('Disposable database required');
    const saved = { ...process.env };
    delete process.env.ORBIT_DEPLOYMENT;
    process.env.ORBIT_CORPORATE_ADMIN_ENABLED = 'true';
    process.env.ORBIT_CORPORATE_ADMIN_CREDENTIALS = JSON.stringify(
      (Object.keys(credentials) as Credential[]).map((key) => ({
        principalId: principal,
        keyId: key,
        capabilities: credentials[key],
        environment: 'local',
        revoked: false,
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        secretSha256: createHash('sha256')
          .update(
            ['orbit-corporate-admin.v1', 'local', key, secrets[key]].join('\0'),
          )
          .digest('hex'),
      })),
    );
    try {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(BILLING_PROVIDER)
        .useValue({
          name: 'STRIPE',
          mode: 'TEST',
          isEnabled: () => true,
          retrieveInvoice: providerLookup,
          retrieveSubscription: providerLookup,
        })
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
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('normalizes contracted prices and discounts with exact arithmetic, segregates modes and currencies, reports gaps', async () => {
    await contract({
      planCode: recurringPlan,
      gross: 12_000,
      discount: { scaledMinor: 20_000_000, endsAt: null },
      suspended: true,
    });
    await contract({ planCode: recurringPlan, months: 6, gross: 60_000 });
    await contract({
      planCode: recurringPlan,
      months: 12,
      gross: 120_000,
      discount: {
        scaledMinor: 20_000_000,
        endsAt: date('2020-01-01').toISOString(),
      },
    });
    await contract({ planCode: recurringPlan, discount: null });
    await contract({ planCode: recurringPlan, paid: false });
    await contract({ planCode: recurringPlan, missing: true });
    await contract({ planCode: recurringPlan, mode: 'LIVE', gross: 9_001 });
    await contract({ planCode: recurringPlan, currency: 'usd', gross: 3_000 });
    const result = await get('recurring-revenue', revenueScope).expect(200);
    expect(data(result)).toMatchObject({
      scale: 120_000,
      currency: 'BRL',
      mode: 'TEST',
      period: null,
      totals: {
        monthlyRecurringScaledMinor: '3600000000',
        grossMonthlyScaledMinor: '3840000000',
        discountMonthlyScaledMinor: '240000000',
        eligibleOrganizations: null,
        confirmedEligibleOrganizations: 4,
        coverage: {
          status: 'PARTIAL',
          candidateOrganizations: 6,
          unknownTermsOrganizations: 1,
          unverifiedPaymentOrganizations: 1,
          pricedOrganizations: 3,
          unpricedOrganizations: 1,
        },
      },
      breakdown: expect.arrayContaining([
        expect.objectContaining({
          planCode: recurringPlan,
          billingInterval: 'MONTHLY',
          monthlyRecurringScaledMinor: '1200000000',
        }),
        expect.objectContaining({
          billingInterval: 'SEMIANNUAL',
          monthlyRecurringScaledMinor: '1200000000',
        }),
        expect.objectContaining({
          billingInterval: 'ANNUAL',
          monthlyRecurringScaledMinor: '1200000000',
        }),
      ]) as unknown,
    });
    const live = await get('recurring-revenue', {
      ...revenueScope,
      mode: 'LIVE',
    }).expect(200);
    expect(data(live)).toMatchObject({
      totals: {
        monthlyRecurringScaledMinor: '1080120000',
        eligibleOrganizations: 1,
        coverage: { status: 'AVAILABLE' },
      },
    });
    const usd = await get('recurring-revenue', {
      ...revenueScope,
      currency: 'USD',
    }).expect(200);
    expect(data(usd)).toMatchObject({
      totals: { monthlyRecurringScaledMinor: '360000000' },
    });
    const none = await get('recurring-revenue', {
      ...scope,
      planCode: 'NO_PLAN',
    }).expect(200);
    expect(data(none)).toMatchObject({
      totals: { monthlyRecurringScaledMinor: '0', eligibleOrganizations: 0 },
    });
    const unavailable = await get('recurring-revenue', {
      ...revenueScope,
      currency: 'JPY',
    }).expect(200);
    expect(data(unavailable)).toMatchObject({
      totals: {
        monthlyRecurringScaledMinor: null,
        coverage: { status: 'UNAVAILABLE' },
      },
    });
  });

  it('reports observed paid entries, effective cancellations and subsequent reactivations with unavailable historical bases', async () => {
    const restarted = await contract({ missing: true });
    const recent = await contract({ missing: true, suspended: true });
    const old = await db.organizationSubscription.update({
      where: { id: restarted.subscription.id },
      data: { status: 'CANCELED', endedAt: date('2007-01-22') },
    });
    await invoice(
      { ...restarted, subscription: old },
      '2006-12-09',
      payment('2006-12-10'),
    );
    const resumed = await db.organizationSubscription.create({
      data: {
        organizationId: restarted.org.id,
        providerCustomerId: old.providerCustomerId,
        providerSubscriptionId: 'sub_restarted_' + randomUUID(),
        provider: 'STRIPE',
        status: 'ACTIVE',
        catalogVersion: old.catalogVersion,
        planCode: old.planCode,
        entitlementsSnapshot: {},
        billingInterval: 'MONTHLY',
        billingAnchorAt: date('2007-02-02'),
        currentPeriodStart: date('2007-02-02'),
        currentPeriodEnd: date('2007-03-03'),
        startedAt: date('2007-02-02'),
      },
    });
    await invoice(
      { ...restarted, subscription: resumed },
      '2007-02-02',
      payment('2007-02-03'),
    );
    await invoice(recent, '2007-02-05', payment('2007-02-06'));
    await db.organizationSubscription.update({
      where: { id: recent.subscription.id },
      data: { cancelAtPeriodEnd: true, canceledAt: date('2007-03-03') },
    });
    await invoice(
      await contract({ mode: 'LIVE', missing: true }),
      '2007-02-05',
      payment('2007-02-06'),
    );
    const result = await get('customer-lifecycle', period).expect(200);
    expect(data(result)).toMatchObject({
      observed: {
        firstObservedPaidOrganizations: 1,
        organizationsWithFirstReceiptForAContract: 2,
        recordedPaidCancellations: 1,
        observedReactivatedOrganizations: 1,
      },
      openingPaidOrganizations: null,
      closingPaidOrganizations: null,
      lostOpeningOrganizations: null,
      retainedOpeningOrganizations: null,
      lostOpeningMrrScaledMinor: null,
      expansionMrrScaledMinor: null,
      contractionMrrScaledMinor: null,
      coverage: { status: 'PARTIAL' },
    });
  });

  it('counts a first grant once and recognizes only settled in-window receipt evidence in the requested mode', async () => {
    const paid = await contract({ missing: true });
    const noReceipt = await contract({ missing: true });
    const prior = await contract({ missing: true });
    const otherMode = await contract({ mode: 'LIVE', missing: true });
    for (const fixture of [paid, noReceipt, prior, otherMode])
      await trial(fixture, '2008-01-01', '2008-02-01');
    await trial(paid, '2008-01-05', '2008-02-05');
    await invoice(paid, '2008-02-02', payment('2008-02-03'));
    await invoice(paid, '2008-02-08', payment('2008-02-09'));
    await invoice(noReceipt, '2008-02-02', {
      status: 'PAID',
      amountRemainingMinor: 0,
      amountPaidMinor: 3000,
    });
    await invoice(prior, '2007-12-02', payment('2007-12-03'));
    await invoice(prior, '2008-02-02', payment('2008-02-03'));
    await invoice(otherMode, '2008-02-02', payment('2008-02-03'));
    const result = await get('trial-conversion', {
      ...scope,
      from: '2008-01-01',
      to: '2008-02-01',
      planCode: 'ESSENTIAL',
    }).expect(200);
    expect(data(result)).toMatchObject({
      startedOrganizations: 4,
      scheduledInProgressOrganizations: 0,
      scheduledEndedOrganizations: 4,
      confirmedConvertedOrganizations: 1,
      eligibleOrganizations: 4,
      confirmedEligibleConversions: 1,
      observationWindowDays: 30,
      conversionRatePercent: null,
      coverage: { status: 'PARTIAL' },
    });
    const inProgress = await contract({ missing: true });
    const today = new Date();
    const start = new Date(today.getTime() - day);
    const ends = new Date(today.getTime() + 20 * day);
    await trial(
      inProgress,
      start.toISOString().slice(0, 10),
      ends.toISOString().slice(0, 10),
    );
    const current = await get('trial-conversion', {
      ...scope,
      from: start.toISOString().slice(0, 10),
      to: ends.toISOString().slice(0, 10),
    }).expect(200);
    expect(data(current)).toMatchObject({
      startedOrganizations: 1,
      scheduledInProgressOrganizations: 1,
      eligibleOrganizations: 0,
    });
  });

  it('uses the same issued invoice population, counts organizations once and exposes missing due dates or plans', async () => {
    const late = await contract({ missing: true });
    const unknown = await contract({ missing: true });
    const collected = await contract({ missing: true });
    const excluded = await contract({ missing: true });
    const invoiceDate = '2010-01-05';
    await invoice(late, invoiceDate, { dueAt: date('2010-02-01') });
    await invoice(late, invoiceDate, { dueAt: date('2010-02-02') });
    await invoice(unknown, invoiceDate, { planCodeAtIssue: null });
    await invoice(collected, invoiceDate, payment('2010-01-07'));
    await invoice(excluded, invoiceDate, { status: 'VOID' });
    await invoice(excluded, invoiceDate, {
      status: 'PAID',
      amountPaidMinor: 0,
      amountDueMinor: 0,
      amountRemainingMinor: 0,
    });
    const filters = { ...scope, from: '2010-01-01', to: '2010-04-01' };
    const result = await get('delinquency', filters).expect(200);
    expect(data(result)).toMatchObject({
      eligibleOrganizations: 3,
      overdueOrganizations: 1,
      observedRatePercent: '33.33',
      coverage: {
        status: 'PARTIAL',
        undatedOpenOrganizations: 1,
        unattributedInvoices: 1,
        historicalPlanFilter: false,
      },
    });
    const filtered = await get('delinquency', {
      ...filters,
      planCode: 'PROFESSIONAL',
    }).expect(200);
    expect(data(filtered)).toMatchObject({
      eligibleOrganizations: 2,
      overdueOrganizations: 1,
      observedRatePercent: '50.00',
      coverage: {
        status: 'PARTIAL',
        undatedOpenOrganizations: 0,
        unattributedInvoices: 1,
        historicalPlanFilter: true,
      },
    });
    const empty = await get('delinquency', { ...filters, mode: 'LIVE' }).expect(
      200,
    );
    expect(data(empty)).toMatchObject({
      eligibleOrganizations: 0,
      overdueOrganizations: 0,
      observedRatePercent: null,
    });
  });

  it('enforces explicit capabilities, validates filters, preserves RLS and audits without financial or tenant data', async () => {
    await get('recurring-revenue', scope, 'finance').expect(403);
    await get('customer-lifecycle', period, 'revenue').expect(403);
    await get('recurring-revenue', { currency: 'BRL' }).expect(400);
    await get('trial-conversion', { ...period, to: '2010-01-01' }).expect(400);
    await get('customer-lifecycle', {
      ...period,
      planCode: 'ESSENTIAL',
    }).expect(400);
    await request(app.getHttpServer())
      .get(root + 'recurring-revenue')
      .query(scope)
      .expect(401);
    const correlationId = randomUUID();
    const administrator = randomUUID();
    const response = await get('recurring-revenue', scope, 'revenue')
      .set('X-Correlation-Id', correlationId)
      .set('X-Nexus-Administrator-Id', administrator)
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { requestId: correlationId, action: 'CORPORATE_ANALYTICS_READ' },
    });
    expect(audit.organizationId).toBeNull();
    expect(audit.metadata).toEqual({
      technicalPrincipalId: principal,
      declaredNexusAdministratorId: administrator,
      correlationId,
      mode: 'TEST',
      operation: 'REVENUE',
      outcome: 'CONFIRMED',
    });

    const fixture = await contract({ missing: true });
    const contexts = app.get(RequestContextStorage);
    const rls = app.get(RlsTransaction);
    const context = (organizationId: string | null) =>
      new RequestContext({
        requestId: randomUUID(),
        actorType: organizationId ? 'SYSTEM' : 'ANONYMOUS',
        userId: null,
        organizationId: organizationId as never,
        businessUnitId: null,
        businessUnitIds: [],
        roles: [],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      });
    const visible = (organizationId: string | null) =>
      contexts.run(context(organizationId), () =>
        rls.runAmbient(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.corporate_analytics_principal', ${principal}, true),
          set_config('app.corporate_analytics_operation', 'DELINQUENCY', true),
          set_config('app.corporate_analytics_mode', 'TEST', true)`;
          return tx.organizationSubscription.count({
            where: { id: fixture.subscription.id },
          });
        }),
      );
    expect(await visible(null)).toBe(0);
    expect(await visible(randomUUID())).toBe(0);
    expect(providerLookup).not.toHaveBeenCalled();
  });
});
