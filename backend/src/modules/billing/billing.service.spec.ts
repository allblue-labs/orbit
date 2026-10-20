import {
  BillingInterval,
  PlanCode,
} from '../subscription-plans/catalog/plan-catalog.types';
import { SubscriptionStatus } from '../subscription-plans/subscriptions/subscription.types';
import { BillingCheckoutNotAllowedException } from './billing.errors';
import { BillingService } from './billing.service';
import {
  BillingMode,
  ProviderBillingState,
  BillingProviderName,
  type BillingProvider,
  type CheckoutSession,
  type CheckoutSessionRequest,
  type ProviderSubscription,
} from './billing.types';

describe('BillingService checkout intent', () => {
  const organizationId = '01900000-0000-7000-8000-000000000001';
  const subscriptionId = '01900000-0000-7000-8000-000000000002';
  const customerId = '01900000-0000-7000-8000-000000000003';
  const attemptId = '01900000-0000-7000-8000-000000000004';

  const currentSubscription = () => ({
    id: subscriptionId,
    organizationId,
    planCode: PlanCode.PROFESSIONAL,
    billingInterval: BillingInterval.MONTHLY,
    effectiveStatus: SubscriptionStatus.PENDING_PAYMENT,
    providerSubscriptionId: null,
    trialEndsAt: null,
  });

  const checkoutAttempt = () => ({
    id: attemptId,
    organizationId,
    subscriptionId,
    billingCustomerId: customerId,
    provider: BillingProviderName.STRIPE,
    mode: BillingMode.TEST,
    planCode: PlanCode.PROFESSIONAL,
    billingInterval: BillingInterval.MONTHLY,
    status: 'CREATING',
    idempotencyKey: 'orbit:checkout-attempt:stable',
    providerSessionId: null,
    providerSubscriptionId: null,
    expiresAt: null,
    completedAt: null,
    failedAt: null,
    failureCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const setup = () => {
    const createCheckoutSession = jest
      .fn<Promise<CheckoutSession>, [CheckoutSessionRequest]>()
      .mockResolvedValue({
        providerSessionId: 'cs_test_stable',
        url: 'https://checkout.stripe.test/c/cs_test_stable',
        expiresAt: new Date('2026-10-15T00:00:00.000Z'),
      });
    const provider = {
      name: BillingProviderName.STRIPE,
      mode: BillingMode.TEST,
      isEnabled: jest.fn().mockReturnValue(true),
      createCheckoutSession,
      retrieveCheckoutSession: jest.fn(),
    } as unknown as BillingProvider;
    const repository = {
      findCustomer: jest.fn().mockResolvedValue({
        id: customerId,
        organizationId,
        provider: BillingProviderName.STRIPE,
        mode: BillingMode.TEST,
        providerCustomerId: 'cus_test_stable',
      }),
      beginCheckoutAttempt: jest.fn().mockResolvedValue({
        attempt: checkoutAttempt(),
        created: true,
      }),
      openCheckoutAttempt: jest.fn().mockResolvedValue(undefined),
    };
    const subscriptions = {
      requireCurrent: jest.fn().mockResolvedValue(currentSubscription()),
    };
    const service = new BillingService(
      provider,
      repository as never,
      subscriptions as never,
    );
    return {
      service,
      provider,
      repository,
      subscriptions,
      createCheckoutSession,
    };
  };

  it('persiste a intenção antes de abrir a sessão no provedor', async () => {
    const { service, repository, createCheckoutSession } = setup();

    await service.createCheckoutSession({
      organizationId,
      planCode: PlanCode.PROFESSIONAL,
      billingInterval: BillingInterval.MONTHLY,
    });

    expect(repository.beginCheckoutAttempt).toHaveBeenCalledTimes(1);
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutAttemptId: attemptId,
        subscriptionId,
        idempotencyKey: 'orbit:checkout-attempt:stable',
      }),
    );
    expect(
      repository.beginCheckoutAttempt.mock.invocationCallOrder[0]!,
    ).toBeLessThan(createCheckoutSession.mock.invocationCallOrder[0]!);
    expect(repository.openCheckoutAttempt).toHaveBeenCalledWith({
      id: attemptId,
      providerSessionId: 'cs_test_stable',
      expiresAt: new Date('2026-10-15T00:00:00.000Z'),
    });
  });

  it('replay usa a identidade durável já existente', async () => {
    const { service, repository, createCheckoutSession } = setup();
    repository.beginCheckoutAttempt.mockResolvedValue({
      attempt: checkoutAttempt(),
      created: false,
    });
    const input = {
      organizationId,
      planCode: PlanCode.PROFESSIONAL,
      billingInterval: BillingInterval.MONTHLY,
    } as const;

    await service.createCheckoutSession(input);
    await service.createCheckoutSession(input);

    const calls = createCheckoutSession.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![0].checkoutAttemptId).toBe(attemptId);
    expect(calls[1]![0].checkoutAttemptId).toBe(attemptId);
    expect(calls[0]![0].idempotencyKey).toBe(calls[1]![0].idempotencyKey);
  });

  it('recusa cobrar um plano diferente da assinatura local', async () => {
    const { service, repository, createCheckoutSession } = setup();

    await expect(
      service.createCheckoutSession({
        organizationId,
        planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
        billingInterval: BillingInterval.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(BillingCheckoutNotAllowedException);
    expect(repository.beginCheckoutAttempt).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  describe('provider-backed commands', () => {
    const linkedSubscription = (overrides: Record<string, unknown> = {}) => ({
      ...currentSubscription(),
      version: 7,
      planCode: PlanCode.PROFESSIONAL,
      billingInterval: BillingInterval.MONTHLY,
      status: SubscriptionStatus.ACTIVE,
      effectiveStatus: SubscriptionStatus.ACTIVE,
      providerSubscriptionId: 'sub_test_authority',
      providerCustomerId: 'cus_test_authority',
      cancelAtPeriodEnd: false,
      ...overrides,
    });
    const providerSubscription = (
      overrides: Partial<ProviderSubscription> = {},
    ): ProviderSubscription => ({
      providerSubscriptionId: 'sub_test_authority',
      providerCustomerId: 'cus_test_authority',
      providerPriceId: 'price_test_authority',
      state: ProviderBillingState.ACTIVE,
      rawStatus: 'active',
      currentPeriodStart: new Date('2026-10-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-11-01T00:00:00.000Z'),
      cancelAtPeriodEnd: false,
      trialEndsAt: null,
      providerUpdatedAt: new Date('2026-10-02T00:00:00.000Z'),
      ...overrides,
    });

    const commandSetup = (
      subscription = linkedSubscription(),
      providerResult = providerSubscription(),
    ) => {
      const setCancelAtPeriodEnd = jest.fn().mockResolvedValue(providerResult);
      const changePlan = jest.fn();
      const provider = {
        name: BillingProviderName.STRIPE,
        mode: BillingMode.TEST,
        isEnabled: jest.fn().mockReturnValue(true),
        setCancelAtPeriodEnd,
        changePlan,
        retrieveSubscription: jest.fn().mockResolvedValue(providerResult),
      } as unknown as BillingProvider;
      const subscriptions = {
        requireCurrent: jest.fn().mockResolvedValue(subscription),
        applyProviderCancellation: jest.fn().mockResolvedValue(undefined),
        applyProviderPlan: jest.fn().mockResolvedValue(undefined),
        scheduleProviderPlanChange: jest.fn().mockResolvedValue(undefined),
      };
      return {
        service: new BillingService(
          provider,
          {} as never,
          subscriptions as never,
        ),
        provider,
        subscriptions,
        setCancelAtPeriodEnd,
        changePlan,
      };
    };

    it('confirma cancelamento no provedor antes de refletir localmente', async () => {
      const { service, subscriptions, setCancelAtPeriodEnd } = commandSetup(
        linkedSubscription(),
        providerSubscription({ cancelAtPeriodEnd: true }),
      );

      await service.cancelSubscription(organizationId, 7);

      expect(setCancelAtPeriodEnd).toHaveBeenCalledWith(
        expect.objectContaining({
          providerSubscriptionId: 'sub_test_authority',
          cancelAtPeriodEnd: true,
        }),
      );
      expect(setCancelAtPeriodEnd.mock.invocationCallOrder[0]!).toBeLessThan(
        subscriptions.applyProviderCancellation.mock.invocationCallOrder[0]!,
      );
    });

    it('não altera estado local quando o cancelamento falha no provedor', async () => {
      const { service, subscriptions, setCancelAtPeriodEnd } = commandSetup();
      setCancelAtPeriodEnd.mockRejectedValue(new Error('provider unavailable'));

      await expect(
        service.cancelSubscription(organizationId, 7),
      ).rejects.toThrow('provider unavailable');
      expect(subscriptions.applyProviderCancellation).not.toHaveBeenCalled();
    });

    it('recusa o comando antes da escrita quando o customer não pertence ao vínculo', async () => {
      const { service, provider, setCancelAtPeriodEnd } = commandSetup();
      (provider.retrieveSubscription as jest.Mock).mockResolvedValue(
        providerSubscription({ providerCustomerId: 'cus_foreign' }),
      );

      await expect(
        service.cancelSubscription(organizationId, 7),
      ).rejects.toMatchObject({ code: 'BILLING_COMMAND_NOT_ALLOWED' });
      expect(setCancelAtPeriodEnd).not.toHaveBeenCalled();
    });

    it('agenda downgrade no período confirmado pelo provedor', async () => {
      const { service, subscriptions, changePlan } = commandSetup();
      const effectiveAt = new Date('2026-11-01T00:00:00.000Z');
      changePlan.mockResolvedValue({
        subscription: providerSubscription(),
        scheduled: true,
        effectiveAt,
        providerScheduleId: 'sub_sched_test',
      });

      await service.changeSubscriptionPlan({
        organizationId,
        expectedVersion: 7,
        planCode: PlanCode.ESSENTIAL,
        billingInterval: BillingInterval.MONTHLY,
      });

      expect(changePlan).toHaveBeenCalledWith(
        expect.objectContaining({
          timing: 'PERIOD_END',
          organizationId,
          subscriptionId,
        }),
      );
      expect(subscriptions.scheduleProviderPlanChange).toHaveBeenCalledWith(
        organizationId,
        7,
        PlanCode.ESSENTIAL,
        BillingInterval.MONTHLY,
        effectiveAt,
      );
      expect(subscriptions.applyProviderPlan).not.toHaveBeenCalled();
    });

    it('libera upgrade somente com preço e período confirmados', async () => {
      const { service, subscriptions, changePlan } = commandSetup();
      const confirmed = providerSubscription({
        providerPriceId: 'price_professional_intelligence',
      });
      changePlan.mockResolvedValue({
        subscription: confirmed,
        scheduled: false,
        effectiveAt: confirmed.currentPeriodStart,
        providerScheduleId: null,
      });

      await service.changeSubscriptionPlan({
        organizationId,
        expectedVersion: 7,
        planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
        billingInterval: BillingInterval.MONTHLY,
      });

      expect(changePlan).toHaveBeenCalledWith(
        expect.objectContaining({ timing: 'IMMEDIATE' }),
      );
      expect(subscriptions.applyProviderPlan).toHaveBeenCalledWith(
        organizationId,
        7,
        expect.objectContaining({
          planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
          activate: true,
        }),
      );
    });
  });
});
