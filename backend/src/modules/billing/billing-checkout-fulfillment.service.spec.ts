import { RequestContextStorage } from '../../context';
import {
  BillingInterval,
  PlanCode,
} from '../subscription-plans/catalog/plan-catalog.types';
import { SubscriptionStatus } from '../subscription-plans/subscriptions/subscription.types';
import {
  BillingCheckoutAwaitingPaymentError,
  BillingCheckoutFulfillmentService,
} from './billing-checkout-fulfillment.service';
import { BillingMode, BillingProviderName } from './billing.types';
import { ProviderCheckoutState, type BillingProvider } from './billing.types';

describe('BillingCheckoutFulfillmentService', () => {
  const organizationId = '01900000-0000-7000-8000-000000000001';
  const subscriptionId = '01900000-0000-7000-8000-000000000002';
  const attemptId = '01900000-0000-7000-8000-000000000003';
  const customerId = '01900000-0000-7000-8000-000000000004';
  const providerSessionId = 'cs_test_checkout';
  const providerSubscriptionId = 'sub_test_checkout';
  const providerCustomerId = 'cus_test_checkout';
  const providerPriceId = 'price_professional_monthly';

  const canonicalSession = () => ({
    providerSessionId,
    state: ProviderCheckoutState.COMPLETE,
    rawStatus: 'complete',
    paymentStatus: 'paid',
    providerCustomerId,
    providerSubscriptionId,
    providerPriceId,
    url: null,
    expiresAt: new Date('2026-10-15T00:00:00.000Z'),
    metadata: {
      checkoutAttemptId: attemptId,
      organizationId,
      subscriptionId,
      planCode: PlanCode.PROFESSIONAL,
      billingInterval: BillingInterval.MONTHLY,
    },
  });

  const attempt = () => ({
    id: attemptId,
    organizationId,
    subscriptionId,
    billingCustomerId: customerId,
    provider: BillingProviderName.STRIPE,
    mode: BillingMode.TEST,
    planCode: PlanCode.PROFESSIONAL,
    billingInterval: BillingInterval.MONTHLY,
    status: 'OPEN',
    idempotencyKey: 'orbit:checkout-attempt:key',
    providerSessionId,
    providerSubscriptionId: null,
    expiresAt: null,
    completedAt: null,
    failedAt: null,
    failureCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    billingCustomer: {
      id: customerId,
      organizationId,
      provider: BillingProviderName.STRIPE,
      mode: BillingMode.TEST,
      providerCustomerId,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  const setup = () => {
    const contexts = new RequestContextStorage();
    const provider = {
      name: BillingProviderName.STRIPE,
      mode: BillingMode.TEST,
      retrieveCheckoutSession: jest.fn().mockResolvedValue(canonicalSession()),
    } as unknown as BillingProvider;
    const repository = {
      findCheckoutAttemptForFulfillment: jest.fn().mockResolvedValue(attempt()),
      completeCheckoutAttempt: jest.fn().mockResolvedValue(undefined),
    };
    const subscriptions = {
      requireCurrent: jest.fn().mockImplementation(() => {
        expect(contexts.get()?.actorType).toBe('SYSTEM');
        expect(contexts.get()?.organizationId).toBe(organizationId);
        return Promise.resolve({
          id: subscriptionId,
          organizationId,
          planCode: PlanCode.PROFESSIONAL,
          billingInterval: BillingInterval.MONTHLY,
          effectiveStatus: SubscriptionStatus.PENDING_PAYMENT,
        });
      }),
      linkProvider: jest.fn().mockResolvedValue(undefined),
    };
    const config = {
      priceId: jest.fn().mockReturnValue(providerPriceId),
    };
    const service = new BillingCheckoutFulfillmentService(
      provider,
      config as never,
      repository as never,
      subscriptions as never,
      contexts,
    );
    return { service, provider, repository, subscriptions, config };
  };

  it('liga e conclui apenas após validar a sessão canônica', async () => {
    const { service, repository, subscriptions } = setup();

    await expect(service.fulfill(providerSessionId)).resolves.toBe(
      providerSubscriptionId,
    );
    expect(subscriptions.linkProvider).toHaveBeenCalledWith(subscriptionId, {
      provider: BillingProviderName.STRIPE,
      providerSubscriptionId,
      providerCustomerId,
      providerPriceId,
      providerStatus: 'checkout:complete',
    });
    expect(repository.completeCheckoutAttempt).toHaveBeenCalledWith({
      id: attemptId,
      providerSessionId,
      providerSubscriptionId,
    });
  });

  it('recusa metadata que tenta correlacionar outra organização', async () => {
    const { service, provider, subscriptions, repository } = setup();
    (provider.retrieveCheckoutSession as jest.Mock).mockResolvedValue({
      ...canonicalSession(),
      metadata: {
        ...canonicalSession().metadata,
        organizationId: '01900000-0000-7000-8000-000000000099',
      },
    });

    await expect(service.fulfill(providerSessionId)).rejects.toThrow(
      'CHECKOUT_CORRELATION_MISMATCH',
    );
    expect(subscriptions.linkProvider).not.toHaveBeenCalled();
    expect(repository.completeCheckoutAttempt).not.toHaveBeenCalled();
  });

  it('recusa preço diferente do catálogo server-owned', async () => {
    const { service, provider, subscriptions } = setup();
    (provider.retrieveCheckoutSession as jest.Mock).mockResolvedValue({
      ...canonicalSession(),
      providerPriceId: 'price_do_plano_errado',
    });

    await expect(service.fulfill(providerSessionId)).rejects.toThrow(
      'CHECKOUT_PRICE_MISMATCH',
    );
    expect(subscriptions.linkProvider).not.toHaveBeenCalled();
  });

  it('não concede acesso enquanto o primeiro pagamento está pendente', async () => {
    const { service, provider, subscriptions, repository } = setup();
    (provider.retrieveCheckoutSession as jest.Mock).mockResolvedValue({
      ...canonicalSession(),
      paymentStatus: 'unpaid',
    });

    await expect(service.fulfill(providerSessionId)).rejects.toBeInstanceOf(
      BillingCheckoutAwaitingPaymentError,
    );
    expect(subscriptions.linkProvider).not.toHaveBeenCalled();
    expect(repository.completeCheckoutAttempt).not.toHaveBeenCalled();
  });
});
