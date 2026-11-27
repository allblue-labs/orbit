import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { RequestContext, RequestContextStorage } from '../src/context';
import { RlsTransaction } from '../src/database';
import { BillingRepository } from '../src/modules/billing/billing.repository';
import { BillingReconciliationService } from '../src/modules/billing/billing-reconciliation.service';
import {
  BillingRecoveryService,
  BillingRecoveryWorker,
} from '../src/modules/billing/billing-recovery.service';
import { BillingConfig } from '../src/modules/billing/billing.config';
import {
  BILLING_PROVIDER,
  type BillingProvider,
  type ProviderSubscription,
  type ProviderInvoice,
  type ProviderEvent,
  type ProviderFinancialAdjustment,
} from '../src/modules/billing/billing.types';
import { CATALOG_VERSION } from '../src/modules/subscription-plans/catalog/plan-catalog.types';
import { planDefinition } from '../src/modules/subscription-plans/catalog/plan-registry';
import { snapshotOf } from '../src/modules/subscription-plans/subscriptions/subscription.snapshot';
import { adminPrisma, disconnectAdminPrisma } from './support/admin-prisma';

jest.setTimeout(120_000);
interface Fixture {
  org: string;
  id: string;
  sub: string;
  customer: string;
  start: Date;
  end: Date;
}

describe('ORB-NX-04 recovery and financial atomicity / real restricted PostgreSQL', () => {
  const admin = adminPrisma();
  let app: INestApplication;
  let repository: BillingRepository,
    reconciliation: BillingReconciliationService,
    recovery: BillingRecoveryService;
  let rls: RlsTransaction, contexts: RequestContextStorage;
  const subscriptions = new Map<string, ProviderSubscription>();
  const invoices = new Map<string, ProviderInvoice>();
  const adjustments = new Map<string, ProviderFinancialAdjustment>();
  let history: ProviderEvent[] = [];
  const provider = {
    name: 'STRIPE',
    mode: 'TEST',
    isEnabled: () => true,
    retrieveSubscription: jest.fn((id: string) => {
      const row = subscriptions.get(id);
      if (!row)
        return Promise.reject(new Error('BILLING_UNKNOWN_TEST_SUBSCRIPTION'));
      return Promise.resolve(row);
    }),
    retrieveInvoice: jest.fn((id: string) => {
      const row = invoices.get(id);
      if (!row)
        return Promise.reject(new Error('BILLING_UNKNOWN_TEST_INVOICE'));
      return Promise.resolve(row);
    }),
    retrieveInvoicePaymentInvoice: jest.fn((id: string) =>
      Promise.resolve(id.replace('inpay_', 'in_')),
    ),
    retrieveFinancialAdjustment: jest.fn((_type: string, id: string) =>
      Promise.resolve(adjustments.get(id)!),
    ),
    listRecoveryEvents: jest.fn((input: { after?: string; limit: number }) => {
      const offset = input.after
        ? history.findIndex((e) => e.providerEventId === input.after) + 1
        : 0;
      return Promise.resolve({
        events: history.slice(offset, offset + input.limit),
        hasMore: offset + input.limit < history.length,
      });
    }),
  } as unknown as BillingProvider;
  const eventId = () => `evt_nx04_${randomUUID()}`;
  async function tenant<T>(f: Fixture, work: () => Promise<T>): Promise<T> {
    return contexts.run(
      new RequestContext({
        requestId: randomUUID(),
        actorType: 'SYSTEM',
        userId: null,
        organizationId: f.org as never,
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
  }
  async function fixture(status = 'ACTIVE', mode = 'TEST'): Promise<Fixture> {
    const email = `nx04.${randomUUID()}@example.test`;
    const owner = await admin.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'NX04',
        lastName: 'Owner',
        displayName: 'NX04',
        status: 'ACTIVE',
      },
    });
    const plan = await admin.plan.findFirstOrThrow({
      where: { isActive: true },
    });
    const org = await admin.organization.create({
      data: {
        ownerUserId: owner.id,
        planId: plan.id,
        slug: `nx04-${randomUUID()}`,
        displayName: 'NX04',
        primarySegment: 'HVAC',
        status: 'ACTIVE',
      },
    });
    const start = new Date(Date.now() - 86_400_000),
      end = new Date(Date.now() + 29 * 86_400_000);
    const sub = `sub_nx04_${randomUUID()}`,
      customer = `cus_nx04_${randomUUID()}`;
    const row = await admin.organizationSubscription.create({
      data: {
        organizationId: org.id,
        planCode: 'PROFESSIONAL',
        catalogVersion: CATALOG_VERSION,
        entitlementsSnapshot: snapshotOf(
          planDefinition('PROFESSIONAL'),
        ) as unknown as Prisma.InputJsonValue,
        billingInterval: 'MONTHLY',
        status,
        billingAnchorAt: start,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        provider: 'STRIPE',
        providerSubscriptionId: sub,
        providerCustomerId: customer,
        providerPriceId: 'price_nx04',
      },
    });
    await admin.billingCustomer.create({
      data: {
        organizationId: org.id,
        provider: 'STRIPE',
        mode,
        providerCustomerId: customer,
      },
    });
    subscriptions.set(sub, {
      mode: mode as 'TEST' | 'LIVE',
      providerSubscriptionId: sub,
      providerCustomerId: customer,
      providerPriceId: 'price_nx04',
      state: 'ACTIVE',
      rawStatus: 'active',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      providerUpdatedAt: null,
    });
    return { org: org.id, id: row.id, sub, customer, start, end };
  }
  function invoice(
    f: Fixture,
    patch: Partial<ProviderInvoice> = {},
  ): ProviderInvoice {
    return {
      mode: 'TEST',
      providerInvoiceId: `in_nx04_${randomUUID()}`,
      providerSubscriptionId: f.sub,
      providerCustomerId: f.customer,
      number: null,
      status: 'PAID',
      currency: 'brl',
      subtotalMinor: 24990,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 24990,
      amountDueMinor: 24990,
      amountPaidMinor: 24990,
      amountRemainingMinor: 0,
      creditNotesMinor: 0,
      attempted: true,
      attemptCount: 1,
      billingReason: 'subscription_cycle',
      collectionMethod: 'charge_automatically',
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
      subscriptionLines: [
        {
          subscriptionId: f.sub,
          priceId: 'price_nx04',
          periodStart: f.start,
          periodEnd: f.end,
        },
      ],
      periodStart: f.start,
      periodEnd: f.end,
      dueAt: null,
      nextPaymentAttemptAt: null,
      finalizedAt: f.start,
      paidAt: f.start,
      voidedAt: null,
      markedUncollectibleAt: null,
      providerCreatedAt: f.start,
      providerObservedAt: new Date(),
      paymentEvidence: [],
      ...patch,
    };
  }
  function record(f: Fixture, inv: ProviderInvoice, id = eventId()) {
    return tenant(f, () =>
      repository.recordInvoice({
        organizationId: f.org,
        subscriptionId: f.id,
        provider: 'STRIPE',
        mode: 'TEST',
        providerEventId: id,
        invoice: inv,
      }),
    );
  }
  function event(
    f: Fixture,
    type = 'customer.subscription.updated',
    objectId = f.sub,
  ): ProviderEvent {
    return {
      mode: 'TEST',
      providerEventId: eventId(),
      type,
      apiVersion: null,
      createdAt: new Date(),
      objectId,
      subscriptionId: f.sub,
    };
  }
  function enqueue(e: ProviderEvent, mode: 'TEST' | 'LIVE' = 'TEST') {
    return repository.recordEvent({
      mode,
      provider: 'STRIPE',
      providerEventId: e.providerEventId,
      eventType: e.type,
      providerObjectId: e.objectId,
      providerSubscriptionId: e.subscriptionId,
      apiVersion: e.apiVersion,
      providerCreatedAt: e.createdAt,
    });
  }
  async function rewind() {
    await admin.$executeRaw`UPDATE billing_recovery_checkpoints SET next_run_at='1970-01-01',status='READY',token=NULL,lease_until=NULL,attempts=0,cursor='{}'`;
  }
  async function drain() {
    await reconciliation.drainInbox();
  }
  async function current(f: Fixture) {
    return admin.organizationSubscription.findUniqueOrThrow({
      where: { id: f.id },
    });
  }
  beforeAll(async () => {
    process.env.BILLING_RECOVERY_ENABLED = 'true';
    process.env.JOBS_WORKER_ENABLED = 'false';
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BILLING_PROVIDER)
      .useValue(provider)
      .compile();
    app = module.createNestApplication();
    await app.init();
    repository = app.get(BillingRepository);
    reconciliation = app.get(BillingReconciliationService);
    recovery = app.get(BillingRecoveryService);
    rls = app.get(RlsTransaction);
    contexts = app.get(RequestContextStorage);
    jest
      .spyOn(app.get(BillingConfig), 'catalogEntryForPrice')
      .mockImplementation((price) =>
        Promise.resolve(
          price === 'price_nx04'
            ? {
                planCode: 'PROFESSIONAL',
                billingInterval: 'MONTHLY',
                amountMinor: 14990,
              }
            : null,
        ),
      );
  });
  beforeEach(async () => {
    history = [];
    (provider.listRecoveryEvents as jest.Mock).mockClear();
    await admin.billingWebhookEvent.updateMany({
      where: { processingStatus: { in: ['PENDING', 'PROCESSING'] } },
      data: {
        processingStatus: 'IGNORED',
        processingToken: null,
        leaseExpiresAt: null,
      },
    });
    await rewind();
  });
  afterAll(async () => {
    process.env.BILLING_RECOVERY_ENABLED = 'false';
    if (app) await app.close();
    await disconnectAdminPrisma();
  });

  it('runs as orbit_app without superuser or BYPASSRLS', async () => {
    const f = await fixture();
    const [role] = await tenant(f, () =>
      rls.run(
        (tx) =>
          tx.$queryRaw<
            { name: string; rolsuper: boolean; rolbypassrls: boolean }[]
          >`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`,
      ),
    );
    expect(role).toMatchObject({
      name: 'orbit_app',
      rolsuper: false,
      rolbypassrls: false,
    });
  });
  it('reproduces P2002 and transaction rollback with PostgreSQL, not a mock', async () => {
    const f = await fixture(),
      inv = invoice(f),
      id = eventId();
    await record(f, inv, id);
    let caught = '';
    await tenant(f, () =>
      rls.run(async (tx) => {
        const row = await tx.billingInvoice.findFirstOrThrow({
          where: { organizationId: f.org },
        });
        await tx.billingInvoice.update({
          where: { id: row.id },
          data: { attemptCount: 99 },
        });
        const existing = await tx.billingInvoiceTransition.findFirstOrThrow({
          where: { providerEventId: id },
        });
        try {
          await tx.billingInvoiceTransition.create({
            data: {
              ...existing,
              id: randomUUID(),
              adjustmentFact: Prisma.DbNull,
            },
          });
        } catch (error) {
          caught = (error as { code: string }).code;
        }
        // Old implementation returned success here; PostgreSQL COMMIT rolls back the aborted transaction.
      }),
    );
    expect(caught).toBe('P2002');
    expect(
      (
        await admin.billingInvoice.findFirstOrThrow({
          where: { providerInvoiceId: inv.providerInvoiceId },
        })
      ).attemptCount,
    ).toBe(1);
  });
  it('proves queries after caught uniqueness error fail in the aborted transaction', async () => {
    const f = await fixture(),
      inv = invoice(f),
      id = eventId();
    await record(f, inv, id);
    await expect(
      tenant(f, () =>
        rls.run(async (tx) => {
          const existing = await tx.billingInvoiceTransition.findFirstOrThrow({
            where: { providerEventId: id },
          });
          try {
            await tx.billingInvoiceTransition.create({
              data: {
                ...existing,
                id: randomUUID(),
                adjustmentFact: Prisma.DbNull,
              },
            });
          } catch {
            /* The aborted transaction is intentional in this reproduction. */
          }
          await tx.$queryRaw`SELECT 1`;
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2010' });
  });
  it('concurrent replay inserts one invoice and one transition and commits successfully', async () => {
    const f = await fixture(),
      inv = invoice(f),
      id = eventId();
    await Promise.all(Array.from({ length: 8 }, () => record(f, inv, id)));
    const rows = await admin.billingInvoice.findMany({
      where: { organizationId: f.org },
      include: { transitions: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.transitions).toHaveLength(1);
    expect(rows[0]!.version).toBe(1);
  });
  it('concurrent distinct events share one invoice and retain both observations', async () => {
    const f = await fixture(),
      inv = invoice(f);
    await Promise.all([record(f, inv), record(f, inv)]);
    expect(
      await admin.billingInvoice.count({ where: { organizationId: f.org } }),
    ).toBe(1);
    expect(
      await admin.billingInvoiceTransition.count({
        where: { organizationId: f.org },
      }),
    ).toBe(2);
  });
  it('rolls invoice and transition back together when a financial constraint fails', async () => {
    const f = await fixture();
    await expect(record(f, invoice(f, { currency: 'BRL' }))).rejects.toThrow();
    expect(
      await admin.billingInvoice.count({ where: { organizationId: f.org } }),
    ).toBe(0);
    expect(
      await admin.billingInvoiceTransition.count({
        where: { organizationId: f.org },
      }),
    ).toBe(0);
  });
  it('ignores delayed invoice snapshots without regressing a newer payment', async () => {
    const f = await fixture(),
      inv = invoice(f);
    await record(f, inv);
    await record(f, {
      ...inv,
      status: 'OPEN',
      amountPaidMinor: 0,
      amountRemainingMinor: 24990,
      providerObservedAt: new Date(inv.providerObservedAt.getTime() - 10_000),
    });
    expect(
      (
        await admin.billingInvoice.findFirstOrThrow({
          where: { organizationId: f.org },
        })
      ).status,
    ).toBe('PAID');
  });
  it('recovers a lost webhook through scheduled discovery and the real inbox', async () => {
    const f = await fixture();
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      state: 'PAYMENT_FAILED',
      rawStatus: 'past_due',
    });
    history = [event(f)];
    await recovery.run();
    for (let retry = 0; retry < 3; retry++) {
      await drain();
      const received = await admin.billingWebhookEvent.findFirstOrThrow({
        where: { providerEventId: history[0]!.providerEventId },
      });
      if (received.processingStatus === 'PROCESSED') break;
      await admin.billingWebhookEvent.updateMany({
        where: { id: received.id, processingStatus: 'PENDING' },
        data: { nextAttemptAt: new Date(0) },
      });
    }
    expect((await current(f)).status).toBe('GRACE_PERIOD');
    const received = await admin.billingWebhookEvent.findFirstOrThrow({
      where: { providerEventId: history[0]!.providerEventId },
    });
    expect({
      status: received.processingStatus,
      error: received.lastErrorCode,
      attempts: received.attempts,
    }).toMatchObject({ status: 'PROCESSED', error: null });
  });
  it('deduplicates concurrent webhook / sweep delivery durably', async () => {
    const f = await fixture(),
      inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    const e = event(f, 'invoice.paid', inv.providerInvoiceId);
    history = [e];
    await Promise.all([enqueue(e), recovery.run()]);
    await drain();
    expect(
      await admin.billingWebhookEvent.count({
        where: { providerEventId: e.providerEventId },
      }),
    ).toBe(1);
    expect(
      await admin.billingInvoiceTransition.count({
        where: { organizationId: f.org },
      }),
    ).toBe(1);
  });
  it('two replicas cannot hold the same recovery stream lease', async () => {
    const [a, b] = await Promise.all([
      recovery.claim('EVENTS'),
      recovery.claim('EVENTS'),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
  it('two event workers cannot claim the same subscription event', async () => {
    const f = await fixture();
    await enqueue(event(f));
    const claims = await Promise.all([
      repository.claimNextEvent({
        mode: 'TEST',
        leaseMs: 120000,
        maxAttempts: 8,
      }),
      repository.claimNextEvent({
        mode: 'TEST',
        leaseMs: 120000,
        maxAttempts: 8,
      }),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
  it('reclaims a crashed discovery lease and rejects its stale checkpoint', async () => {
    const a = (await recovery.claim('EVENTS'))!;
    await admin.$executeRaw`UPDATE billing_recovery_checkpoints SET lease_until=now()-interval '1 second' WHERE key=${a.key}`;
    const b = (await recovery.claim('EVENTS'))!;
    expect(b.token).not.toBe(a.token);
    await expect(recovery.checkpoint(a, [], {}, true, 1)).rejects.toThrow(
      'BILLING_RECOVERY_LEASE_LOST',
    );
    await recovery.checkpoint(b, [], {}, true, 1);
  });
  it('fences a crashed event before persistence and converges after reclamation', async () => {
    const f = await fixture(),
      inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    await enqueue(event(f, 'invoice.paid', inv.providerInvoiceId));
    const old = (await repository.claimNextEvent({
      mode: 'TEST',
      leaseMs: 120000,
      maxAttempts: 8,
    }))!;
    await admin.billingWebhookEvent.update({
      where: { id: old.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await expect(
      repository.withClaim(old, () => record(f, inv, old.providerEventId)),
    ).rejects.toThrow();
    expect(
      await admin.billingInvoice.count({ where: { organizationId: f.org } }),
    ).toBe(0);
    await drain();
    expect(
      await admin.billingInvoice.count({ where: { organizationId: f.org } }),
    ).toBe(1);
  });
  it('recovers crash after financial persistence before ACK without a second effect', async () => {
    const f = await fixture(),
      inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    await enqueue(event(f, 'invoice.paid', inv.providerInvoiceId));
    const claim = (await repository.claimNextEvent({
      mode: 'TEST',
      leaseMs: 120000,
      maxAttempts: 8,
    }))!;
    await repository.withClaim(claim, () =>
      reconciliation.reconcileProviderInvoice(
        inv.providerInvoiceId,
        claim.providerEventId,
      ),
    );
    await admin.billingWebhookEvent.update({
      where: { id: claim.id },
      data: { leaseExpiresAt: new Date(0) },
    });
    await drain();
    expect(
      await admin.billingInvoiceTransition.count({
        where: { organizationId: f.org },
      }),
    ).toBe(1);
    expect(
      (
        await admin.billingInvoice.findFirstOrThrow({
          where: { organizationId: f.org },
        })
      ).version,
    ).toBe(1);
  });
  it('an old failure event reads current provider truth without revoking paid access', async () => {
    const f = await fixture(),
      inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    const e = event(f, 'invoice.payment_failed', inv.providerInvoiceId);
    await enqueue({ ...e, createdAt: new Date(Date.now() - 86_400_000) });
    await drain();
    expect((await current(f)).status).toBe('ACTIVE');
    const fact = await admin.billingInvoiceTransition.findFirstOrThrow({
      where: { providerEventId: e.providerEventId },
    });
    expect(fact.sourceEventType).toBe('invoice.payment_failed');
    expect(fact.status).toBe('PAID');
    expect(fact.sourceOccurredAt! < fact.observedAt).toBe(true);
  });
  it('records refund and invoice atomically, rejecting a partial negative adjustment', async () => {
    const f = await fixture(),
      inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    const id = `re_${randomUUID()}`;
    adjustments.set(id, {
      type: 'REFUND',
      providerObjectId: id,
      providerInvoiceId: inv.providerInvoiceId,
      status: 'SUCCEEDED',
      amountMinor: -1,
      currency: 'brl',
      reason: null,
      occurredAt: f.start,
      providerObservedAt: new Date(),
    });
    await expect(
      reconciliation.reconcileProviderAdjustment('REFUND', id, eventId()),
    ).rejects.toThrow();
    expect(
      await admin.billingInvoice.count({ where: { organizationId: f.org } }),
    ).toBe(0);
    expect(
      await admin.billingInvoiceTransition.count({
        where: { organizationId: f.org },
      }),
    ).toBe(0);
  });
  it('retains refund requested and completed observations, without inventing completion time', async () => {
    const f = await fixture(),
      inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    const id = `re_${randomUUID()}`;
    const adjustment: ProviderFinancialAdjustment = {
      type: 'REFUND',
      providerObjectId: id,
      providerInvoiceId: inv.providerInvoiceId,
      status: 'PENDING',
      amountMinor: 1000,
      currency: 'brl',
      reason: null,
      occurredAt: f.start,
      providerObservedAt: new Date(),
    };
    adjustments.set(id, adjustment);
    await reconciliation.reconcileProviderAdjustment('REFUND', id, eventId());
    adjustments.set(id, {
      ...adjustment,
      status: 'SUCCEEDED',
      providerObservedAt: new Date(),
    });
    const e = eventId();
    await Promise.all([
      reconciliation.reconcileProviderAdjustment('REFUND', id, e),
      reconciliation.reconcileProviderAdjustment('REFUND', id, e),
    ]);
    expect(
      await admin.billingFinancialAdjustment.count({
        where: { organizationId: f.org },
      }),
    ).toBe(1);
    const facts = await admin.billingInvoiceTransition.findMany({
      where: { organizationId: f.org },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      facts.map((f) => (f.adjustmentFact as { status: string }).status),
    ).toEqual(['PENDING', 'SUCCEEDED']);
    expect(facts[1]!.adjustmentFact).not.toHaveProperty('completedAt');
  });
  it('records dispute open and closed states against the same invoice', async () => {
    const f = await fixture(),
      inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    const id = `dp_${randomUUID()}`;
    for (const status of ['NEEDS_RESPONSE', 'WON']) {
      adjustments.set(id, {
        type: 'DISPUTE',
        providerObjectId: id,
        providerInvoiceId: inv.providerInvoiceId,
        status,
        amountMinor: 2000,
        currency: 'brl',
        reason: null,
        occurredAt: f.start,
        providerObservedAt: new Date(),
      });
      await reconciliation.reconcileProviderAdjustment(
        'DISPUTE',
        id,
        eventId(),
      );
    }
    expect(
      (
        await admin.billingFinancialAdjustment.findFirstOrThrow({
          where: { organizationId: f.org },
        })
      ).status,
    ).toBe('WON');
    expect(
      await admin.billingInvoiceTransition.count({
        where: { organizationId: f.org },
      }),
    ).toBe(2);
  });
  it('an old contract event cannot end a newer purchase, while its invoice can be recovered', async () => {
    const f = await fixture();
    await admin.organizationSubscription.update({
      where: { id: f.id },
      data: { endedAt: new Date(), status: 'EXPIRED' },
    });
    const old = await current(f);
    const next = await admin.organizationSubscription.create({
      data: {
        ...old,
        entitlementsSnapshot: old.entitlementsSnapshot as Prisma.InputJsonValue,
        id: randomUUID(),
        endedAt: null,
        status: 'PENDING_PAYMENT',
        pendingEntitlementsSnapshot: Prisma.DbNull,
        previousEntitlementsSnapshot: Prisma.DbNull,
        recurringObservation: Prisma.DbNull,
        providerSubscriptionId: `sub_new_${randomUUID()}`,
        version: 1,
      },
    });
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      state: 'ENDED',
      rawStatus: 'canceled',
    });
    await reconciliation.reconcileProviderSubscription(f.sub, eventId());
    expect(
      (
        await admin.organizationSubscription.findUniqueOrThrow({
          where: { id: next.id },
        })
      ).status,
    ).toBe('PENDING_PAYMENT');
    const inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    await reconciliation.reconcileProviderInvoice(
      inv.providerInvoiceId,
      eventId(),
    );
    expect(
      (
        await admin.billingInvoice.findFirstOrThrow({
          where: { organizationId: f.org },
        })
      ).subscriptionId,
    ).toBe(f.id);
  });
  it('preserves a scheduled plan change and the current paid period', async () => {
    const f = await fixture();
    await admin.organizationSubscription.update({
      where: { id: f.id },
      data: {
        pendingPlanCode: 'ESSENTIAL',
        pendingBillingInterval: 'MONTHLY',
        pendingEffectiveAt: f.end,
        pendingCatalogVersion: CATALOG_VERSION,
        pendingEntitlementsSnapshot: snapshotOf(
          planDefinition('ESSENTIAL'),
        ) as unknown as Prisma.InputJsonValue,
      },
    });
    await reconciliation.reconcileProviderSubscription(f.sub, eventId());
    const row = await current(f);
    expect(row.pendingPlanCode).toBe('ESSENTIAL');
    expect(row.currentPeriodEnd).toEqual(f.end);
    expect(row.planCode).toBe('PROFESSIONAL');
  });
  it('preserves future cancellation without ending the paid period now', async () => {
    const f = await fixture();
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      cancelAtPeriodEnd: true,
    });
    await reconciliation.reconcileProviderSubscription(f.sub, eventId());
    const row = await current(f);
    expect(row.status).toBe('ACTIVE');
    expect(row.cancelAtPeriodEnd).toBe(true);
    expect(row.currentPeriodEnd).toEqual(f.end);
  });
  it('reactivates a new pending contract only after a matching paid invoice', async () => {
    const f = await fixture('PENDING_PAYMENT'),
      inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      latestInvoiceId: inv.providerInvoiceId,
    });
    await reconciliation.reconcileProviderSubscription(f.sub, eventId());
    expect((await current(f)).status).toBe('ACTIVE');
  });
  it.each(['NO_INVOICE', 'OPEN', 'WRONG_CUSTOMER', 'WRONG_PERIOD'])(
    'does not activate without financial confirmation: %s',
    async (scenario) => {
      const f = await fixture('PENDING_PAYMENT'),
        inv = invoice(
          f,
          scenario === 'OPEN'
            ? { status: 'OPEN' }
            : scenario === 'WRONG_CUSTOMER'
              ? { providerCustomerId: 'cus_other' }
              : scenario === 'WRONG_PERIOD'
                ? { subscriptionLines: [] }
                : {},
        );
      invoices.set(inv.providerInvoiceId, inv);
      subscriptions.set(f.sub, {
        ...subscriptions.get(f.sub)!,
        latestInvoiceId:
          scenario === 'NO_INVOICE' ? null : inv.providerInvoiceId,
      });
      await expect(
        reconciliation.reconcileProviderSubscription(f.sub, eventId()),
      ).rejects.toThrow('BILLING_PLAN_PAYMENT_NOT_CONFIRMED');
      expect((await current(f)).status).toBe('PENDING_PAYMENT');
    },
  );
  it('does not extend a paid period from ACTIVE alone', async () => {
    const f = await fixture();
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      currentPeriodEnd: new Date(f.end.getTime() + 30 * 86_400_000),
    });
    await expect(
      reconciliation.reconcileProviderSubscription(f.sub, eventId()),
    ).rejects.toThrow('BILLING_PLAN_PAYMENT_NOT_CONFIRMED');
    expect((await current(f)).currentPeriodEnd).toEqual(f.end);
  });
  it('does not grant a remote trial that Orbit never approved', async () => {
    const f = await fixture('PENDING_PAYMENT');
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      state: 'TRIALING',
      rawStatus: 'trialing',
      trialEndsAt: f.end,
    });
    await expect(
      reconciliation.reconcileProviderSubscription(f.sub, eventId()),
    ).rejects.toThrow('BILLING_TRIAL_NOT_GRANTED');
  });
  it('retains a completed page and resumes after partial backfill failure', async () => {
    const f = await fixture();
    history = Array.from({ length: 27 }, () => event(f));
    await recovery.run();
    const before = await admin.billingRecoveryCheckpoint.findUniqueOrThrow({
      where: { key: 'STRIPE:TEST:EVENTS' },
    });
    expect((before.cursor as { after: string }).after).toBe(
      history[24]!.providerEventId,
    );
    (provider.listRecoveryEvents as jest.Mock).mockRejectedValueOnce(
      new Error('BILLING_PROVIDER_TIMEOUT'),
    );
    await recovery.run();
    expect(
      (
        await admin.billingRecoveryCheckpoint.findUniqueOrThrow({
          where: { key: before.key },
        })
      ).cursor,
    ).toEqual(before.cursor);
    await admin.billingRecoveryCheckpoint.update({
      where: { key: before.key },
      data: { nextRunAt: new Date(0) },
    });
    await recovery.run();
    expect(
      (
        (provider.listRecoveryEvents as jest.Mock).mock.calls as [
          { after?: string; limit: number },
        ][]
      ).at(-1)![0].after,
    ).toBe(history[24]!.providerEventId);
    expect(
      await admin.billingWebhookEvent.count({
        where: {
          providerEventId: { in: history.map((e) => e.providerEventId) },
        },
      }),
    ).toBe(27);
  });
  it('a restarted instance resumes the persisted cursor', async () => {
    const f = await fixture();
    history = Array.from({ length: 26 }, () => event(f));
    await recovery.run();
    const restarted = new BillingRecoveryService(
      provider,
      repository,
      reconciliation,
    );
    await restarted.run();
    expect(
      await admin.billingWebhookEvent.count({
        where: {
          providerEventId: { in: history.map((e) => e.providerEventId) },
        },
      }),
    ).toBe(26);
  });
  it('quarantines expired history instead of silently skipping a gap', async () => {
    await recovery.claim('EVENTS');
    await admin.billingRecoveryCheckpoint.update({
      where: { key: 'STRIPE:TEST:EVENTS' },
      data: {
        token: null,
        leaseUntil: null,
        status: 'READY',
        nextRunAt: new Date(0),
        cursor: {
          highWater: new Date(Date.now() - 31 * 86_400_000).toISOString(),
        },
      },
    });
    await recovery.run();
    expect(
      (
        await admin.billingRecoveryCheckpoint.findUniqueOrThrow({
          where: { key: 'STRIPE:TEST:EVENTS' },
        })
      ).lastErrorCode,
    ).toBe('BILLING_HISTORY_WINDOW_EXPIRED');
  });
  it('separates TEST/LIVE claims and rejects wrong-mode contract bindings', async () => {
    const live = await fixture('PENDING_PAYMENT', 'LIVE'),
      e = event(live);
    await enqueue(e, 'LIVE');
    expect(
      await repository.claimNextEvent({
        mode: 'TEST',
        leaseMs: 120000,
        maxAttempts: 8,
      }),
    ).toBeNull();
    await expect(
      reconciliation.reconcileProviderSubscription(live.sub, eventId()),
    ).rejects.toThrow();
    expect((await current(live)).status).toBe('PENDING_PAYMENT');
    const claim = (await recovery.claim('EVENTS'))!;
    await expect(
      recovery.checkpoint(claim, [{ ...e, mode: 'LIVE' }], {}, true, 1),
    ).rejects.toThrow('BILLING_MODE_MISMATCH');
  });
  it('does not expose another tenant financial records through RLS', async () => {
    const a = await fixture(),
      b = await fixture();
    await record(a, invoice(a));
    await record(b, invoice(b));
    const rows = await tenant(a, () =>
      rls.run((tx) =>
        tx.billingInvoice.findMany({
          where: { organizationId: { in: [a.org, b.org] } },
        }),
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.organizationId).toBe(a.org);
    expect(
      await tenant(a, () =>
        rls.run((tx) => tx.billingRecoveryCheckpoint.count()),
      ),
    ).toBe(0);
  });
  it('does not claim invoice PAID as confirmed Stripe cash', async () => {
    const f = await fixture(),
      inv = invoice(f);
    await record(f, inv);
    expect(
      (
        await admin.billingInvoice.findFirstOrThrow({
          where: { organizationId: f.org },
        })
      ).paymentEvidence,
    ).toEqual([]);
  });
  it('keeps stable payment correlation IDs under financial replay', async () => {
    const f = await fixture(),
      inv = invoice(f, {
        paymentEvidence: [
          {
            invoicePaymentId: 'inpay_synthetic',
            paymentIntentId: 'pi_synthetic',
            amountMinor: 24990,
            currency: 'brl',
            confirmedAt: new Date().toISOString(),
          },
        ],
      }),
      id = eventId();
    await record(f, inv, id);
    await record(f, inv, id);
    const row = await admin.billingInvoice.findFirstOrThrow({
      where: { organizationId: f.org },
    });
    expect(row.paymentEvidence).toEqual(inv.paymentEvidence);
    expect(row.version).toBe(1);
  });
  it('financial recovery still runs while the organization is operationally suspended', async () => {
    const f = await fixture();
    await admin.organization.update({
      where: { id: f.org },
      data: { status: 'SUSPENDED' },
    });
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      state: 'PAYMENT_FAILED',
      rawStatus: 'past_due',
    });
    await reconciliation.reconcileProviderSubscription(f.sub, eventId());
    expect((await current(f)).status).toBe('GRACE_PERIOD');
    expect(
      (await admin.organization.findUniqueOrThrow({ where: { id: f.org } }))
        .status,
    ).toBe('SUSPENDED');
  });
  it('dead letters exhausted recovery and reports backlog without payloads', async () => {
    const claim = (await recovery.claim('EVENTS'))!;
    await recovery.fail(
      { ...claim, attempts: 8 },
      new Error('BILLING_PROVIDER_TIMEOUT'),
    );
    expect(
      (
        await admin.billingRecoveryCheckpoint.findUniqueOrThrow({
          where: { key: claim.key },
        })
      ).status,
    ).toBe('DEAD_LETTER');
    expect(await recovery.claim('EVENTS')).toBeNull();
    const report = JSON.stringify(await recovery.diagnostics());
    expect(report).not.toContain('sk_live');
    expect(report).toContain('DEAD_LETTER');
  });
  it('the real timer triggers recovery and stops cleanly', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const instance = new BillingRecoveryWorker({
      settings: { enabled: true, pollMs: 10000 },
      run,
    } as never);
    const previous = process.env.JOBS_WORKER_ENABLED;
    process.env.JOBS_WORKER_ENABLED = 'true';
    instance.onModuleInit();
    await instance.onModuleDestroy();
    process.env.JOBS_WORKER_ENABLED = previous;
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('rolls back a conflicting event identity across tenants instead of leaving a partial invoice', async () => {
    const a = await fixture(),
      b = await fixture(),
      id = eventId();
    const results = await Promise.allSettled([
      record(a, invoice(a), id),
      record(b, invoice(b), id),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await admin.billingInvoice.count({
        where: { organizationId: { in: [a.org, b.org] } },
      }),
    ).toBe(1);
    expect(
      await admin.billingInvoiceTransition.count({
        where: { providerEventId: id },
      }),
    ).toBe(1);
  });
  it('two replicas handling different events for the same contract converge once', async () => {
    const f = await fixture();
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      state: 'PAYMENT_FAILED',
      rawStatus: 'past_due',
    });
    await enqueue(event(f));
    await enqueue(event(f));
    await Promise.all([drain(), drain()]);
    const first = await current(f);
    await admin.billingWebhookEvent.updateMany({
      where: { providerSubscriptionId: f.sub, processingStatus: 'PENDING' },
      data: { nextAttemptAt: new Date(0) },
    });
    await drain();
    const final = await current(f);
    expect(final.status).toBe('GRACE_PERIOD');
    expect(final.graceStartsAt).toEqual(first.graceStartsAt);
    expect(final.version).toBe(2);
  });
  it('a delayed stale subscription read cannot overwrite a newer snapshot', async () => {
    const f = await fixture();
    const stale = {
      ...subscriptions.get(f.sub)!,
      state: 'ENDED' as const,
      rawStatus: 'canceled',
    };
    let release!: (row: ProviderSubscription) => void;
    const pending = new Promise<ProviderSubscription>((resolve) => {
      release = resolve;
    });
    (provider.retrieveSubscription as jest.Mock).mockImplementationOnce(
      () => pending,
    );
    const slow = reconciliation.reconcileProviderSubscription(f.sub, eventId());
    await new Promise((resolve) => setTimeout(resolve, 10));
    await reconciliation.reconcileProviderSubscription(f.sub, eventId());
    release(stale);
    await slow;
    expect((await current(f)).status).toBe('ACTIVE');
  });
  it('an interrupted financial transaction rolls back and later replay converges', async () => {
    const f = await fixture(),
      inv = invoice(f),
      id = eventId();
    await expect(
      tenant(f, () =>
        repository.atomic(async () => {
          await repository.recordInvoice({
            organizationId: f.org,
            subscriptionId: f.id,
            provider: 'STRIPE',
            mode: 'TEST',
            providerEventId: id,
            invoice: inv,
          });
          throw new Error('SIMULATED_CRASH');
        }),
      ),
    ).rejects.toThrow('SIMULATED_CRASH');
    expect(
      await admin.billingInvoice.count({ where: { organizationId: f.org } }),
    ).toBe(0);
    await record(f, inv, id);
    expect(
      await admin.billingInvoiceTransition.count({
        where: { organizationId: f.org },
      }),
    ).toBe(1);
  });
  it('duplicate refund replay after another event does not change the adjustment version', async () => {
    const f = await fixture(),
      inv = invoice(f);
    invoices.set(inv.providerInvoiceId, inv);
    const id = `re_${randomUUID()}`;
    adjustments.set(id, {
      type: 'REFUND',
      providerObjectId: id,
      providerInvoiceId: inv.providerInvoiceId,
      status: 'SUCCEEDED',
      amountMinor: 1000,
      currency: 'brl',
      reason: null,
      occurredAt: f.start,
      providerObservedAt: new Date(),
    });
    const first = eventId();
    await reconciliation.reconcileProviderAdjustment('REFUND', id, first);
    await reconciliation.reconcileProviderAdjustment('REFUND', id, eventId());
    const before = await admin.billingFinancialAdjustment.findFirstOrThrow({
      where: { organizationId: f.org },
    });
    await reconciliation.reconcileProviderAdjustment('REFUND', id, first);
    expect(
      (
        await admin.billingFinancialAdjustment.findFirstOrThrow({
          where: { organizationId: f.org },
        })
      ).version,
    ).toBe(before.version);
  });
  it('orders invoice observations by database tickets even with replica clock skew', async () => {
    const f = await fixture(),
      inv = invoice(f);
    const older = await repository.nextObservation(),
      newer = await repository.nextObservation();
    await record(f, {
      ...inv,
      observationVersion: newer,
      providerObservedAt: new Date(Date.now() - 86_400_000),
    });
    await record(f, {
      ...inv,
      observationVersion: older,
      status: 'OPEN',
      amountPaidMinor: 0,
      amountRemainingMinor: 24990,
      providerObservedAt: new Date(Date.now() + 86_400_000),
    });
    expect(
      (
        await admin.billingInvoice.findFirstOrThrow({
          where: { organizationId: f.org },
        })
      ).status,
    ).toBe('PAID');
  });
  it('a future diagnostic timestamp cannot prevent fresh canonical recovery', async () => {
    const f = await fixture();
    await admin.organizationSubscription.update({
      where: { id: f.id },
      data: { providerUpdatedAt: new Date(Date.now() + 86_400_000) },
    });
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      state: 'PAYMENT_FAILED',
      rawStatus: 'past_due',
    });
    await reconciliation.reconcileProviderSubscription(f.sub, eventId());
    expect((await current(f)).status).toBe('GRACE_PERIOD');
    expect((await current(f)).providerObservationVersion > 0n).toBe(true);
  });
  it('recovers confirmed payment facts delivered as invoice_payment.paid', async () => {
    const f = await fixture(),
      inv = invoice(f, {
        providerInvoiceId: `in_nx04_${randomUUID()}`,
        paymentEvidence: [
          {
            invoicePaymentId: 'inpay_recovered',
            paymentIntentId: 'pi_recovered',
            amountMinor: 24990,
            currency: 'brl',
            confirmedAt: new Date().toISOString(),
          },
        ],
      });
    invoices.set(inv.providerInvoiceId, inv);
    history = [
      event(
        f,
        'invoice_payment.paid',
        inv.providerInvoiceId.replace('in_', 'inpay_'),
      ),
    ];
    await recovery.run();
    await drain();
    expect(
      (
        await admin.billingInvoice.findFirstOrThrow({
          where: { organizationId: f.org },
        })
      ).paymentEvidence,
    ).toEqual(inv.paymentEvidence);
  });
  it('does not discover a LIVE contract merely because its tenant also has a TEST customer', async () => {
    const live = await fixture('ACTIVE', 'LIVE');
    await admin.billingCustomer.create({
      data: {
        organizationId: live.org,
        provider: 'STRIPE',
        mode: 'TEST',
        providerCustomerId: `cus_other_${randomUUID()}`,
      },
    });
    const test = await fixture();
    let cursor: string | undefined;
    const all: string[] = [];
    for (let page = 0; page < 10; page++) {
      const rows = await repository.linkedSubscriptions(25, cursor, 'TEST');
      all.push(...rows.map((row) => row.id));
      if (rows.length < 25) break;
      cursor = rows.at(-1)!.id;
    }
    expect(all).not.toContain(live.id);
    expect(all).toContain(test.id);
  });
  it('returns after an ended contract through a new confirmed purchase, preserving the old history', async () => {
    const old = await fixture();
    await admin.organizationSubscription.update({
      where: { id: old.id },
      data: {
        endedAt: new Date(),
        status: 'EXPIRED',
        dataRetentionEndsAt: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    const row = await current(old);
    const sub = `sub_return_${randomUUID()}`;
    const created = await admin.organizationSubscription.create({
      data: {
        ...row,
        id: randomUUID(),
        entitlementsSnapshot: row.entitlementsSnapshot as Prisma.InputJsonValue,
        pendingEntitlementsSnapshot: Prisma.DbNull,
        previousEntitlementsSnapshot: Prisma.DbNull,
        recurringObservation: Prisma.DbNull,
        endedAt: null,
        status: 'PENDING_PAYMENT',
        providerSubscriptionId: sub,
        providerObservationVersion: 0n,
        providerUpdatedAt: null,
        dataRetentionEndsAt: null,
        version: 1,
      },
    });
    const next = { ...old, id: created.id, sub };
    const inv = invoice(next);
    invoices.set(inv.providerInvoiceId, inv);
    subscriptions.set(sub, {
      ...subscriptions.get(old.sub)!,
      providerSubscriptionId: sub,
      latestInvoiceId: inv.providerInvoiceId,
    });
    await reconciliation.reconcileProviderSubscription(sub, eventId());
    expect((await current(next)).status).toBe('ACTIVE');
    const previous = await current(old);
    expect(previous.endedAt).not.toBeNull();
    expect(previous.status).toBe('EXPIRED');
    expect(previous.dataRetentionEndsAt).toBeNull();
  });
  it('keeps the limit adjustment deadline tied to the confirmed renewal under replay', async () => {
    const f = await fixture();
    const paidEnd = new Date(Date.now() - 1000),
      paidStart = new Date(paidEnd.getTime() - 30 * 86_400_000);
    await admin.organizationSubscription.update({
      where: { id: f.id },
      data: {
        planCode: 'PROFESSIONAL_INTELLIGENCE',
        entitlementsSnapshot: snapshotOf(
          planDefinition('PROFESSIONAL_INTELLIGENCE'),
        ) as unknown as Prisma.InputJsonValue,
        currentPeriodStart: paidStart,
        currentPeriodEnd: paidEnd,
      },
    });
    const renewed = {
      ...f,
      start: paidEnd,
      end: new Date(paidEnd.getTime() + 30 * 86_400_000),
    };
    const inv = invoice(renewed);
    invoices.set(inv.providerInvoiceId, inv);
    subscriptions.set(f.sub, {
      ...subscriptions.get(f.sub)!,
      latestInvoiceId: inv.providerInvoiceId,
      currentPeriodStart: renewed.start,
      currentPeriodEnd: renewed.end,
    });
    await reconciliation.reconcileProviderSubscription(f.sub, eventId());
    const first = await current(f);
    expect(first.planCode).toBe('PROFESSIONAL');
    expect(first.limitsChangedAt).toEqual(paidEnd);
    expect(first.previousEntitlementsSnapshot).not.toBeNull();
    await reconciliation.reconcileProviderSubscription(f.sub, eventId());
    expect((await current(f)).limitsChangedAt).toEqual(paidEnd);
  });
});
