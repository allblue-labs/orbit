import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { RequestContext, RequestContextStorage } from '../src/context';
import { RlsTransaction } from '../src/database';
import { BillingRepository } from '../src/modules/billing/billing.repository';
import {
  BILLING_PROVIDER,
  type ProviderInvoice,
} from '../src/modules/billing/billing.types';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(90_000);
const root = '/api/v1/corporate-admin';
const principal = randomUUID();
const administrator = randomUUID();
const credentials = {
  finance: [
    'finance:overview:read',
    'finance:invoices:read',
    'finance:payments:read',
    'finance:organizations:read',
  ],
  previous: [
    'connection:read',
    'organizations:read',
    'subscriptions:read',
    'promotions:read',
  ],
  invoices: ['finance:invoices:read'],
  organizations: ['finance:organizations:read'],
} as const;
type Credential = keyof typeof credentials;
const secrets = {
  finance: randomBytes(32).toString('base64url'),
  previous: randomBytes(32).toString('base64url'),
  invoices: randomBytes(32).toString('base64url'),
  organizations: randomBytes(32).toString('base64url'),
};
const from = new Date('2009-01-01T00:00:00Z');
const december = new Date('2008-12-01T00:00:00Z');
const january = new Date('2009-01-05T00:00:00Z');
const february = new Date('2009-02-05T00:00:00Z');
const to = new Date('2009-03-01T00:00:00Z');
const futureCharge = new Date('2099-01-01T00:00:00Z');
const observed = new Date('2009-02-06T00:00:00Z');
const query = {
  mode: 'TEST',
  currency: 'BRL',
  from: '2009-01-01',
  to: '2009-03-01',
};
const providerLookup = jest.fn(() =>
  Promise.reject(new Error('Unexpected provider lookup')),
);
const db = adminPrisma();

function data<T>(response: request.Response): T {
  return (response.body as { data: T }).data;
}

async function organizationFixture(status: string) {
  const suffix = randomUUID();
  const email = 'adm06-' + suffix + '@example.test';
  const plan = await db.plan.findUniqueOrThrow({
    where: { key: 'PROFESSIONAL' },
  });
  const owner = await db.user.create({
    data: {
      email,
      normalizedEmail: email,
      firstName: 'Synthetic',
      lastName: 'Owner',
      displayName: 'Synthetic owner',
      status: 'ACTIVE',
    },
  });
  const org = await db.organization.create({
    data: {
      ownerUserId: owner.id,
      planId: plan.id,
      slug: 'adm06-' + suffix,
      displayName: 'Synthetic organization',
      primarySegment: 'HVAC_R',
      status,
    },
  });
  const providerCustomerId = 'cus_' + suffix;
  await db.billingCustomer.create({
    data: {
      organizationId: org.id,
      provider: 'STRIPE',
      mode: 'TEST',
      providerCustomerId,
    },
  });
  const sub = await db.organizationSubscription.create({
    data: {
      organizationId: org.id,
      status: 'ACTIVE',
      planCode: 'PROFESSIONAL',
      catalogVersion: plan.catalogVersion,
      entitlementsSnapshot: {},
      billingInterval: 'MONTHLY',
      billingAnchorAt: new Date(),
      currentPeriodStart: new Date(),
      currentPeriodEnd: futureCharge,
      startedAt: from,
      provider: 'STRIPE',
      providerSubscriptionId: 'sub_' + suffix,
      providerCustomerId,
    },
  });
  return { org, sub };
}

type Fixture = Awaited<ReturnType<typeof organizationFixture>>;

function invoiceFixture(
  owner: Fixture,
  overrides: Partial<Prisma.BillingInvoiceUncheckedCreateInput>,
) {
  return db.billingInvoice.create({
    data: {
      organizationId: owner.org.id,
      subscriptionId: owner.sub.id,
      provider: 'STRIPE',
      mode: 'TEST',
      currency: 'brl',
      providerInvoiceId: 'in_' + randomUUID(),
      planCodeAtIssue: 'ESSENTIAL',
      status: 'OPEN',
      amountRemainingMinor: 2_000,
      invoiceNumber: 'SYNTH-001',
      subtotalMinor: 2_000,
      totalMinor: 2_000,
      amountDueMinor: 2_000,
      discountMinor: 0,
      taxMinor: 0,
      amountPaidMinor: 0,
      creditNotesMinor: 0,
      attempted: true,
      attemptCount: 1,
      collectionMethod: 'charge_automatically',
      periodStart: from,
      periodEnd: to,
      providerObservedAt: observed,
      providerCreatedAt: january,
      finalizedAt: january,
      hostedInvoiceUrl: 'https://example.test/private-invoice',
      invoicePdfUrl: 'https://example.test/private-pdf',
      ...overrides,
    },
  });
}

function evidence(
  id: string,
  amountMinor: number,
  confirmedAt: Date,
  currency = 'brl',
) {
  return {
    invoicePaymentId: 'inpay_' + id,
    paymentIntentId: 'pi_shared',
    amountMinor,
    confirmedAt: confirmedAt.toISOString(),
    currency,
  };
}

describe('ADM-06.A corporate SaaS finance with PostgreSQL RLS', () => {
  let app: INestApplication<App>;
  let first: Fixture;
  let second: Fixture;
  let invoiceId: string;
  let orgRoute: string;
  const http = () => request(app.getHttpServer());
  const get = (
    path: string,
    credential: Credential = 'finance',
    filters: object = query,
  ) =>
    http()
      .get(root + path)
      .query(filters)
      .set(
        'Authorization',
        'Bearer orbit-ca1.local.' + credential + '.' + secrets[credential],
      );

  const withScope = <T>(
    organizationId: string | null,
    work: () => Promise<T>,
  ) =>
    app.get(RequestContextStorage).run(
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
      }),
      work,
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
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
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
          createCheckoutSession: providerLookup,
          refund: providerLookup,
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

    first = await organizationFixture('SUSPENDED');
    second = await organizationFixture('ACTIVE');
    orgRoute = '/organizations/' + first.org.id + '/finance';
    const receipt = evidence('adm06_a', 6_000, february);
    const paid = await invoiceFixture(first, {
      invoiceNumber: 'SYNTH-PAID',
      status: 'PAID',
      paidAt: february,
      subtotalMinor: 11_000,
      discountMinor: 1_000,
      totalMinor: 10_000,
      amountPaidMinor: 10_000,
      amountDueMinor: 10_000,
      amountRemainingMinor: 0,
      paymentEvidence: [
        receipt,
        receipt,
        evidence('adm06_b', 4_000, february),
        evidence('wrong_currency', 999, february, 'usd'),
      ],
    });
    invoiceId = paid.id;
    const pastDue = await invoiceFixture(first, {
      dueAt: december,
      nextPaymentAttemptAt: futureCharge,
      amountRemainingMinor: 1_800,
    });
    await invoiceFixture(first, { dueAt: futureCharge });
    await invoiceFixture(first, {
      status: 'UNCOLLECTIBLE',
      amountRemainingMinor: 900,
      totalMinor: 900,
      subtotalMinor: 900,
      amountDueMinor: 900,
    });
    await invoiceFixture(first, { status: 'VOID', totalMinor: 500_000 });
    await invoiceFixture(second, {
      invoiceNumber: 'EXTERNAL',
      status: 'PAID',
      totalMinor: 3_000,
      subtotalMinor: 3_000,
      amountPaidMinor: 3_000,
      amountDueMinor: 3_000,
      amountRemainingMinor: 0,
      paidAt: january,
      planCodeAtIssue: null,
      paymentEvidence: [{ amountMinor: 3_000 }],
    });
    await invoiceFixture(second, {
      invoiceNumber: 'OLD',
      status: 'PAID',
      totalMinor: 1_000,
      subtotalMinor: 1_000,
      amountPaidMinor: 1_000,
      amountDueMinor: 1_000,
      amountRemainingMinor: 0,
      providerCreatedAt: december,
      finalizedAt: december,
      paidAt: january,
      paymentEvidence: [evidence('adm06_old', 1_000, january)],
    });
    await invoiceFixture(first, {
      mode: 'LIVE',
      invoiceNumber: 'TEST-SEPARATION',
      totalMinor: 76_001,
    });
    await invoiceFixture(second, {
      currency: 'usd',
      invoiceNumber: 'CURRENCY-SEPARATION',
      totalMinor: 77_002,
    });
    for (const [type, status, amount] of [
      ['REFUND', 'SUCCEEDED', 1_200],
      ['REFUND', 'PENDING', 300],
      ['REFUND', 'CANCELED', 400],
      ['DISPUTE', 'NEEDS_RESPONSE', 500],
    ] as const) {
      await db.billingFinancialAdjustment.create({
        data: {
          organizationId: first.org.id,
          billingInvoiceId: paid.id,
          provider: 'STRIPE',
          type,
          providerObjectId: 'obj_' + randomUUID(),
          status,
          amountMinor: amount,
          currency: 'brl',
          occurredAt: february,
          providerObservedAt: observed,
          lastProviderEventId: 'evt_' + randomUUID(),
        },
      });
    }
    await db.billingInvoiceTransition.create({
      data: {
        organizationId: first.org.id,
        billingInvoiceId: pastDue.id,
        provider: 'STRIPE',
        providerEventId: 'evt_' + randomUUID(),
        status: 'OPEN',
        attemptCount: 1,
        totalMinor: 2_000,
        amountRemainingMinor: 1_800,
        amountPaidMinor: 0,
        observedAt: observed,
        sourceEventType: 'invoice.payment_failed',
        sourceOccurredAt: january,
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await disconnectAdminPrisma();
  });

  it('separates billed and collected, deduplicating allocations and grouping by the date of each fact', async () => {
    const response = await get('/finance/overview').expect(200);
    expect(data(response)).toMatchObject({
      source: 'ORBIT_STRIPE_RECONCILIATION',
      currency: 'BRL',
      mode: 'TEST',
      totals: {
        subtotalMinor: '18900',
        billedMinor: '17900',
        discountMinor: '1000',
        openMinor: '3800',
        pendingMinor: '2000',
        overdueMinor: '1800',
        uncollectibleMinor: '900',
        confirmedReceivedMinor: '11000',
        recordedRefundMinor: '1200',
        netConfirmedMinor: null,
        overdueOrganizationCount: 1,
        invoices: { OPEN: 2, PAID: 2, VOID: 1, UNCOLLECTIBLE: 1 },
        coverage: {
          unattributedInvoiceCount: 1,
          settledWithoutReceiptEvidenceCount: 1,
          confirmedReceiptCount: 3,
        },
      },
      monthly: [
        {
          month: '2009-01',
          confirmedReceivedMinor: '1000',
          billedMinor: '17900',
        },
        {
          month: '2009-02',
          confirmedReceivedMinor: '10000',
          billedMinor: null,
          recordedRefundMinor: '1200',
        },
      ],
    });
  });

  it('keeps Stripe modes, currency and historical plan filters independent', async () => {
    const live = await get('/finance/overview', 'finance', {
      ...query,
      mode: 'LIVE',
    }).expect(200);
    expect(data(live)).toMatchObject({
      totals: { billedMinor: '76001', confirmedReceivedMinor: null },
    });
    const usd = await get('/finance/overview', 'finance', {
      ...query,
      currency: 'USD',
    }).expect(200);
    expect(data(usd)).toMatchObject({ totals: { billedMinor: '77002' } });
    const selected = await get('/finance/overview', 'finance', {
      ...query,
      planCode: 'ESSENTIAL',
    }).expect(200);
    expect(data(selected)).toMatchObject({
      totals: { billedMinor: '14900', confirmedReceivedMinor: '11000' },
    });
    const noEvidence = await get('/finance/overview', 'finance', {
      ...query,
      planCode: 'PROFESSIONAL',
    }).expect(200);
    expect(data(noEvidence)).toMatchObject({
      totals: {
        billedMinor: null,
        confirmedReceivedMinor: null,
        recordedRefundMinor: null,
        invoices: { OPEN: 0 },
      },
      monthly: [],
    });
  });

  it('filters, searches, and paginates invoices and keeps provider URLs out of the detail', async () => {
    const response = await get('/finance/invoices', 'finance', {
      ...query,
      search: 'synth',
      status: 'OPEN',
      pageSize: '1',
      page: '2',
      sort: 'AMOUNT_ASC',
    }).expect(200);
    expect(data(response)).toMatchObject({
      total: 2,
      page: 2,
      pageSize: 1,
      items: [{ number: 'SYNTH-001' }],
    });
    const detail = await get('/finance/invoices/' + invoiceId, 'finance', {
      mode: 'TEST',
    }).expect(200);
    expect(data(detail)).toMatchObject({
      invoice: {
        id: invoiceId,
        currency: 'BRL',
        planCode: 'ESSENTIAL',
        providerSettledMinor: 10_000,
        confirmedReceivedMinor: '10000',
        balanceStatus: 'NO_OPEN_BALANCE',
      },
    });
    expect(detail.text).not.toMatch(
      /private-(invoice|pdf)|inpay_|pi_shared|providerInvoiceId/,
    );
    await get('/finance/invoices/' + invoiceId, 'finance', {
      mode: 'LIVE',
    }).expect(404);
  });

  it('returns canonical receipts, failed attempts and refund/dispute states with round-trip detail IDs', async () => {
    type Item = {
      id: string;
      kind: string;
      status: string;
      amountMinor: number | null;
    };
    const list = await get('/finance/payments', 'finance', {
      ...query,
      sort: 'AMOUNT_DESC',
    }).expect(200);
    const result = data<{ total: number; items: Item[] }>(list);
    expect(result.total).toBe(8);
    expect(
      result.items.map(({ kind, status, amountMinor }) => [
        kind,
        status,
        amountMinor,
      ]),
    ).toEqual([
      ['RECEIPT', 'CONFIRMED', 6000],
      ['RECEIPT', 'CONFIRMED', 4000],
      ['REFUND', 'SUCCEEDED', 1200],
      ['RECEIPT', 'CONFIRMED', 1000],
      ['DISPUTE', 'NEEDS_RESPONSE', 500],
      ['REFUND', 'CANCELED', 400],
      ['REFUND', 'PENDING', 300],
      ['ATTEMPT', 'REJECTED', null],
    ]);
    for (const item of [
      result.items[0]!,
      result.items[2]!,
      result.items.at(-1)!,
    ]) {
      const detail = await get('/finance/payments/' + item.id, 'finance', {
        mode: 'TEST',
      }).expect(200);
      expect(data(detail)).toMatchObject({ payment: item });
      expect(detail.text).not.toMatch(/inpay_|pi_shared|obj_|evt_/);
    }
    const filtered = await get('/finance/payments', 'finance', {
      ...query,
      invoiceId,
      includeOrganizationName: 'true',
    }).expect(200);
    const linked = data<{
      total: number;
      items: (Item & { invoiceId: string; organizationName: string })[];
    }>(filtered);
    expect(linked.total).toBeGreaterThan(0);
    expect(
      linked.items.every(
        (item) =>
          item.invoiceId === invoiceId &&
          item.organizationName === first.org.displayName,
      ),
    ).toBe(true);
    const otherMode = await get('/finance/payments', 'finance', {
      ...query,
      mode: 'LIVE',
      invoiceId,
    }).expect(200);
    expect(data(otherMode)).toMatchObject({ total: 0, items: [] });
    const named = await get('/finance/invoices/' + invoiceId, 'finance', {
      mode: 'TEST',
      includeOrganizationName: 'true',
    }).expect(200);
    expect(data(named)).toMatchObject({
      invoice: { organizationName: first.org.displayName },
    });
    expect(list.text).not.toContain('organizationName');
    const refunds = await get('/finance/payments', 'finance', {
      ...query,
      kind: 'REFUND',
      status: 'PENDING',
    }).expect(200);
    expect(data(refunds)).toMatchObject({
      total: 1,
      items: [{ status: 'PENDING' }],
    });
  });

  it('keeps financial debt, suspension and subscription separate in scoped reads', async () => {
    const summary = await get(orgRoute).expect(200);
    expect(data(summary)).toMatchObject({
      organization: { id: first.org.id, operationalStatus: 'SUSPENDED' },
      subscription: {
        id: first.sub.id,
        status: 'ACTIVE',
        planCode: 'PROFESSIONAL',
        providerMode: 'TEST',
      },
      balanceStatus: 'OVERDUE',
      nextChargeAt: futureCharge.toISOString(),
      totals: { billedMinor: '14900', confirmedReceivedMinor: '10000' },
    });
    const invoices = await get(orgRoute + '/invoices').expect(200);
    expect(data(invoices)).toMatchObject({ total: 5 });
    expect(invoices.text).not.toContain(second.org.id);
    const payments = await get(orgRoute + '/payments').expect(200);
    expect(data(payments)).toMatchObject({ total: 7 });
    expect(payments.text).not.toContain(second.org.id);
    const live = await get(orgRoute, 'finance', {
      ...query,
      mode: 'LIVE',
    }).expect(200);
    expect(data(live)).toMatchObject({
      subscription: null,
      subscriptionCoverage: 'UNVERIFIED_MODE',
    });
    await get('/organizations/' + randomUUID() + '/finance/invoices').expect(
      404,
    );
  });

  it('keeps the latest cancellation visible when no contract is current', async () => {
    const canceled = await organizationFixture('ACTIVE');
    const endedAt = new Date();
    await db.organizationSubscription.update({
      where: { id: canceled.sub.id },
      data: { status: 'CANCELED', endedAt, canceledAt: endedAt },
    });
    const response = await get(
      '/organizations/' + canceled.org.id + '/finance',
    ).expect(200);
    expect(data(response)).toMatchObject({
      organization: { operationalStatus: 'ACTIVE' },
      subscription: { status: 'CANCELED', endedAt: endedAt.toISOString() },
      nextChargeAt: null,
      balanceStatus: 'INSUFFICIENT_EVIDENCE',
    });
  });

  it('enforces explicit grants, exact filters and read-only RLS and audits without filters or provider calls', async () => {
    await http()
      .get(root + '/finance/overview')
      .query(query)
      .expect(401);
    await get('/finance/overview', 'previous').expect(403);
    await get('/finance/payments', 'invoices').expect(403);
    await get(orgRoute + '/invoices', 'organizations').expect(403);
    await get(orgRoute + '/invoices', 'invoices').expect(403);
    await get('/finance/payments/id', 'finance', { mode: 'TEST' }).expect(400);
    await get('/finance/invoices', 'finance', {
      ...query,
      pageSize: '101',
    }).expect(400);
    await get('/finance/overview', 'finance', {
      ...query,
      to: '2042-03-01',
    }).expect(400);
    await get('/finance/overview', 'finance', { ...query, mode: '' }).expect(
      400,
    );
    await get('/finance/invoices', 'finance', { ...query, search: "%' OR 1=1" })
      .expect(200)
      .expect(({ body }: { body: { data: { total: number } } }) => {
        expect(body.data.total).toBe(0);
      });

    const before = await db.billingInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    const correlation = randomUUID();
    const response = await get('/finance/invoices/' + invoiceId, 'finance', {
      mode: 'TEST',
    })
      .set('X-Nexus-Administrator-Id', administrator)
      .set('X-Correlation-Id', correlation)
      .expect(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const audit = await db.auditLog.findFirstOrThrow({
      where: { requestId: correlation, action: 'CORPORATE_FINANCE_READ' },
    });
    expect(audit.metadata).toEqual({
      technicalPrincipalId: principal,
      declaredNexusAdministratorId: administrator,
      correlationId: correlation,
      operation: 'INVOICE',
      mode: 'TEST',
      outcome: 'CONFIRMED',
    });
    expect(
      await db.billingInvoice.findUnique({ where: { id: invoiceId } }),
    ).toEqual(before);
    expect(providerLookup).not.toHaveBeenCalled();

    const rls = app.get(RlsTransaction);
    await withScope(null, () =>
      rls.run(async (tx) => {
        expect(
          await tx.billingInvoice.findUnique({ where: { id: invoiceId } }),
        ).toBeNull();
        await tx.$queryRaw`
        SELECT set_config('app.corporate_finance_principal', ${principal}, true),
          set_config('app.corporate_finance_mode', 'TEST', true),
          set_config('app.corporate_finance_organization', ${second.org.id}, true)
      `;
        expect(
          await tx.billingInvoice.findUnique({ where: { id: invoiceId } }),
        ).toBeNull();
        expect(await tx.billingInvoice.count()).toBeGreaterThan(0);
        expect(
          (
            await tx.billingInvoice.updateMany({
              data: { invoiceNumber: 'ILLEGAL' },
            })
          ).count,
        ).toBe(0);
        expect(await tx.billingFinancialAdjustment.count()).toBe(0);
      }),
    );
    expect(
      await withScope(null, () => rls.run((tx) => tx.billingInvoice.count())),
    ).toBe(0);
  });

  it('records historic plan attribution only from complete, unambiguous canonical invoice lines', async () => {
    const priceId = 'price_adm06_' + randomUUID();
    await db.planStripePrice.create({
      data: {
        id: priceId,
        planCode: 'ESSENTIAL',
        billingInterval: 'MONTHLY',
        amountMinor: 1000,
      },
    });
    const mock: ProviderInvoice = {
      mode: 'TEST',
      providerInvoiceId: 'in_adm06_' + randomUUID(),
      providerSubscriptionId: first.sub.providerSubscriptionId,
      providerCustomerId: first.sub.providerCustomerId!,
      number: 'LEGACY-PLAN',
      status: 'OPEN',
      currency: 'brl',
      subtotalMinor: 1000,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 1000,
      amountDueMinor: 1000,
      amountPaidMinor: 0,
      amountRemainingMinor: 1000,
      creditNotesMinor: 0,
      attempted: false,
      attemptCount: 0,
      billingReason: 'subscription_cycle',
      collectionMethod: 'charge_automatically',
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
      periodStart: december,
      periodEnd: from,
      providerCreatedAt: december,
      providerObservedAt: observed,
      dueAt: null,
      nextPaymentAttemptAt: null,
      finalizedAt: december,
      paidAt: null,
      voidedAt: null,
      markedUncollectibleAt: null,
      subscriptionLines: [
        {
          priceId,
          subscriptionId: first.sub.providerSubscriptionId,
          periodStart: december,
          periodEnd: from,
        },
      ],
      subscriptionLinesComplete: false,
    };
    const record = (invoice: ProviderInvoice) =>
      withScope(first.org.id, () =>
        app.get(BillingRepository).recordInvoice({
          organizationId: first.org.id,
          subscriptionId: first.sub.id,
          provider: 'STRIPE',
          mode: 'TEST',
          providerEventId: 'evt_' + randomUUID(),
          invoice,
        }),
      );
    const storedPlan = async () =>
      (
        await db.billingInvoice.findFirstOrThrow({
          where: { providerInvoiceId: mock.providerInvoiceId },
        })
      ).planCodeAtIssue;
    await record(mock);
    expect(await storedPlan()).toBeNull();
    await record({ ...mock, subscriptionLinesComplete: true });
    expect(await storedPlan()).toBe('ESSENTIAL');
    await record({
      ...mock,
      subscriptionLinesComplete: true,
      subscriptionLines: [],
    });
    expect(await storedPlan()).toBe('ESSENTIAL');
  });
});
