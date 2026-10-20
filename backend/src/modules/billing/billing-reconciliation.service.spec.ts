import { RequestContextStorage } from '../../context';
import { BillingProviderUnavailableException } from './billing.errors';
import { BillingReconciliationService } from './billing-reconciliation.service';
import {
  BillingMode,
  BillingProviderName,
  ProviderBillingState,
  ProviderFinancialAdjustmentType,
  ProviderInvoiceStatus,
  type BillingProvider,
} from './billing.types';
import {
  BillingInterval,
  PlanCode,
} from '../subscription-plans/catalog/plan-catalog.types';
import { SubscriptionStatus } from '../subscription-plans/subscriptions/subscription.types';

describe('BillingReconciliationService durable inbox', () => {
  const event = (overrides: Record<string, unknown> = {}) => ({
    id: '01900000-0000-7000-8000-000000000001',
    provider: BillingProviderName.STRIPE,
    providerEventId: 'evt_test_1',
    eventType: 'customer.subscription.updated',
    providerObjectId: 'sub_test_1',
    providerSubscriptionId: 'sub_test_1',
    apiVersion: '2026-08-26.dahlia',
    providerCreatedAt: new Date(),
    receivedAt: new Date(),
    processingStatus: 'PROCESSING',
    attempts: 1,
    processingToken: '01900000-0000-7000-8000-000000000002',
    ...overrides,
  });

  const setup = (
    claimed = event(),
    catalogEntry: {
      planCode: PlanCode;
      billingInterval: BillingInterval;
    } | null = null,
  ) => {
    const provider = {
      name: BillingProviderName.STRIPE,
      mode: BillingMode.TEST,
      isEnabled: jest.fn().mockReturnValue(true),
      retrieveSubscription: jest.fn(),
      retrieveInvoice: jest.fn(),
      retrieveFinancialAdjustment: jest.fn(),
    } as unknown as BillingProvider;
    const repository = {
      claimNextEvent: jest
        .fn()
        .mockResolvedValueOnce(claimed)
        .mockResolvedValue(null),
      finishClaimedEvent: jest.fn().mockResolvedValue(undefined),
      retryClaimedEvent: jest.fn().mockResolvedValue(undefined),
      findSubscriptionByProviderId: jest.fn(),
      findSubscriptionForLedgerByProviderId: jest.fn(),
      recordInvoice: jest.fn().mockResolvedValue(undefined),
      recordFinancialAdjustment: jest.fn().mockResolvedValue(undefined),
    };
    const checkout = { fulfill: jest.fn() };
    const subscriptions = {
      currentOrNull: jest.fn(),
      applyProviderPlan: jest.fn().mockResolvedValue(undefined),
      syncProviderSnapshot: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      enabled: catalogEntry !== null,
      catalogEntryForPrice: jest.fn().mockReturnValue(catalogEntry),
    };
    const service = new BillingReconciliationService(
      provider,
      repository as never,
      checkout as never,
      subscriptions as never,
      config as never,
      new RequestContextStorage(),
    );
    return { service, provider, repository, checkout, subscriptions, config };
  };

  it('arquiva evento suportado por assinatura, mas sem consumidor', async () => {
    const claimed = event({ eventType: 'customer.discount.created' });
    const { service, repository } = setup(claimed);

    await expect(service.drainInbox()).resolves.toMatchObject({
      examined: 1,
      ignored: 1,
    });
    expect(repository.finishClaimedEvent).toHaveBeenCalledWith({
      id: claimed.id,
      processingToken: claimed.processingToken,
      status: 'IGNORED',
    });
    expect(repository.retryClaimedEvent).not.toHaveBeenCalled();
  });

  it('devolve ao backoff quando o Stripe está indisponível', async () => {
    const claimed = event();
    const { service, provider, repository } = setup(claimed);
    (provider.retrieveSubscription as jest.Mock).mockRejectedValue(
      new BillingProviderUnavailableException('timeout'),
    );

    await expect(service.drainInbox()).resolves.toMatchObject({
      examined: 1,
      deferred: 1,
      failed: 0,
    });
    expect(repository.retryClaimedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: claimed.id,
        processingToken: claimed.processingToken,
        errorCode: 'PROVIDER_UNAVAILABLE',
        deadLetter: false,
      }),
    );
    expect(repository.finishClaimedEvent).not.toHaveBeenCalled();
  });

  it('manda correlação de checkout inválida para dead-letter', async () => {
    const claimed = event({
      eventType: 'checkout.session.completed',
      providerObjectId: 'cs_test_1',
      providerSubscriptionId: null,
    });
    const { service, repository, checkout } = setup(claimed);
    checkout.fulfill.mockRejectedValue(new Error('CHECKOUT_PRICE_MISMATCH'));

    await expect(service.drainInbox()).resolves.toMatchObject({
      examined: 1,
      failed: 1,
      deferred: 0,
    });
    expect(repository.retryClaimedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'CHECKOUT_PRICE_MISMATCH',
        deadLetter: true,
      }),
    );
  });

  it('encerra em dead-letter quando o orçamento de tentativas acaba', async () => {
    const claimed = event({ attempts: 8 });
    const { service, provider, repository } = setup(claimed);
    (provider.retrieveSubscription as jest.Mock).mockRejectedValue(
      new Error('temporary internal failure'),
    );

    await service.drainInbox();

    expect(repository.retryClaimedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'RETRY_EXHAUSTED',
        deadLetter: true,
      }),
    );
  });

  it('traduz o price id canônico para plano sem confiar no evento', async () => {
    const target = {
      planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
      billingInterval: BillingInterval.ANNUAL,
    } as const;
    const { service, provider, repository, subscriptions } = setup(
      event(),
      target,
    );
    const start = new Date('2026-10-01T00:00:00.000Z');
    const end = new Date('2027-10-01T00:00:00.000Z');
    (provider.retrieveSubscription as jest.Mock).mockResolvedValue({
      providerSubscriptionId: 'sub_test_1',
      providerCustomerId: 'cus_test_1',
      providerPriceId: 'price_target',
      state: ProviderBillingState.ACTIVE,
      rawStatus: 'active',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      providerUpdatedAt: new Date(),
    });
    repository.findSubscriptionByProviderId.mockResolvedValue({
      organizationId: '01900000-0000-7000-8000-000000000099',
      providerCustomerId: 'cus_test_1',
    });
    subscriptions.currentOrNull.mockResolvedValue({
      id: '01900000-0000-7000-8000-000000000098',
      organizationId: '01900000-0000-7000-8000-000000000099',
      version: 4,
      effectiveStatus: SubscriptionStatus.ACTIVE,
      planCode: PlanCode.PROFESSIONAL,
      billingInterval: BillingInterval.MONTHLY,
      currentPeriodStart: start,
      currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
    });

    await service.reconcileProviderSubscription('sub_test_1', 'evt_test_1');

    expect(subscriptions.applyProviderPlan).toHaveBeenCalledWith(
      '01900000-0000-7000-8000-000000000099',
      4,
      {
        planCode: target.planCode,
        billingInterval: target.billingInterval,
        period: { start, end },
        activate: true,
        cancelAtPeriodEnd: false,
      },
    );
  });

  it('materializa a fatura canônica sem persistir payload do webhook', async () => {
    const { service, provider, repository } = setup();
    const now = new Date('2026-10-15T00:00:00.000Z');
    const invoice = {
      providerInvoiceId: 'in_test_1',
      providerSubscriptionId: 'sub_test_1',
      providerCustomerId: 'cus_test_1',
      number: 'ORBIT-0001',
      status: ProviderInvoiceStatus.PAID,
      currency: 'brl',
      subtotalMinor: 14990,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 14990,
      amountDueMinor: 14990,
      amountPaidMinor: 14990,
      amountRemainingMinor: 0,
      creditNotesMinor: 0,
      attempted: true,
      attemptCount: 1,
      billingReason: 'subscription_cycle',
      collectionMethod: 'charge_automatically',
      hostedInvoiceUrl: 'https://invoice.stripe.test/i/ORBIT-0001',
      invoicePdfUrl: 'https://invoice.stripe.test/i/ORBIT-0001.pdf',
      periodStart: now,
      periodEnd: new Date('2026-11-15T00:00:00.000Z'),
      dueAt: null,
      nextPaymentAttemptAt: null,
      finalizedAt: now,
      paidAt: now,
      voidedAt: null,
      markedUncollectibleAt: null,
      providerCreatedAt: now,
      providerObservedAt: now,
    };
    (provider.retrieveInvoice as jest.Mock).mockResolvedValue(invoice);
    repository.findSubscriptionForLedgerByProviderId.mockResolvedValue({
      id: '01900000-0000-7000-8000-000000000098',
      organizationId: '01900000-0000-7000-8000-000000000099',
      providerCustomerId: 'cus_test_1',
    });

    await expect(
      service.reconcileProviderInvoice('in_test_1', 'evt_invoice_1'),
    ).resolves.toBe('sub_test_1');
    expect(repository.recordInvoice).toHaveBeenCalledWith({
      organizationId: '01900000-0000-7000-8000-000000000099',
      subscriptionId: '01900000-0000-7000-8000-000000000098',
      provider: BillingProviderName.STRIPE,
      mode: BillingMode.TEST,
      providerEventId: 'evt_invoice_1',
      invoice,
    });
  });

  it('correlaciona reembolso pela fatura canônica e registra somente dados financeiros normalizados', async () => {
    const { service, provider, repository } = setup();
    const observedAt = new Date('2026-10-16T00:00:00.000Z');
    const adjustment = {
      type: ProviderFinancialAdjustmentType.REFUND,
      providerObjectId: 're_test_1',
      providerInvoiceId: 'in_test_1',
      status: 'SUCCEEDED',
      amountMinor: 14990,
      currency: 'brl',
      reason: 'requested_by_customer',
      occurredAt: observedAt,
      providerObservedAt: observedAt,
    };
    const invoice = {
      providerInvoiceId: 'in_test_1',
      providerSubscriptionId: 'sub_test_1',
      providerCustomerId: 'cus_test_1',
      number: 'ORBIT-0001',
      status: ProviderInvoiceStatus.PAID,
      currency: 'brl',
      subtotalMinor: 14990,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 14990,
      amountDueMinor: 14990,
      amountPaidMinor: 14990,
      amountRemainingMinor: 0,
      creditNotesMinor: 0,
      attempted: true,
      attemptCount: 1,
      billingReason: 'subscription_cycle',
      collectionMethod: 'charge_automatically',
      hostedInvoiceUrl: null,
      invoicePdfUrl: null,
      periodStart: observedAt,
      periodEnd: new Date('2026-11-16T00:00:00.000Z'),
      dueAt: null,
      nextPaymentAttemptAt: null,
      finalizedAt: observedAt,
      paidAt: observedAt,
      voidedAt: null,
      markedUncollectibleAt: null,
      providerCreatedAt: observedAt,
      providerObservedAt: observedAt,
    };
    (provider.retrieveFinancialAdjustment as jest.Mock).mockResolvedValue(
      adjustment,
    );
    (provider.retrieveInvoice as jest.Mock).mockResolvedValue(invoice);
    repository.findSubscriptionForLedgerByProviderId.mockResolvedValue({
      id: '01900000-0000-7000-8000-000000000098',
      organizationId: '01900000-0000-7000-8000-000000000099',
      providerCustomerId: 'cus_test_1',
    });

    await expect(
      service.reconcileProviderAdjustment(
        ProviderFinancialAdjustmentType.REFUND,
        're_test_1',
        'evt_refund_1',
      ),
    ).resolves.toBe('sub_test_1');
    expect(repository.recordInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: '01900000-0000-7000-8000-000000000099',
        providerEventId: 'evt_refund_1',
        invoice,
      }),
    );
    expect(repository.recordFinancialAdjustment).toHaveBeenCalledWith({
      organizationId: '01900000-0000-7000-8000-000000000099',
      provider: BillingProviderName.STRIPE,
      providerEventId: 'evt_refund_1',
      adjustment,
    });
  });
});
