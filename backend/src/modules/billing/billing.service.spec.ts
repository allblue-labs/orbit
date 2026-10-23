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
    version: 1,
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
    subscriptionVersion: 1,
    endsTrial: false,
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
      const createPlanChangeSession = jest
        .fn()
        .mockResolvedValue({ url: 'https://billing.stripe.test/confirm' });
      const provider = {
        name: BillingProviderName.STRIPE,
        mode: BillingMode.TEST,
        isEnabled: jest.fn().mockReturnValue(true),
        setCancelAtPeriodEnd,
        changePlan,
        createPlanChangeSession,
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
        createPlanChangeSession,
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

    it.each([PlanCode.ESSENTIAL, PlanCode.PROFESSIONAL_INTELLIGENCE])(
      'abre confirmação Stripe para %s sem alterar direitos',
      async (planCode) => {
        const { service, subscriptions, createPlanChangeSession, changePlan } =
          commandSetup();
        await expect(
          service.changeSubscriptionPlan({
            organizationId,
            expectedVersion: 7,
            planCode,
            billingInterval: BillingInterval.MONTHLY,
          }),
        ).resolves.toEqual({ url: 'https://billing.stripe.test/confirm' });
        expect(createPlanChangeSession).toHaveBeenCalledWith({
          providerCustomerId: 'cus_test_authority',
          providerSubscriptionId: 'sub_test_authority',
          planCode,
          billingInterval: BillingInterval.MONTHLY,
        });
        expect(changePlan).not.toHaveBeenCalled();
        expect(subscriptions.applyProviderPlan).not.toHaveBeenCalled();
        expect(subscriptions.scheduleProviderPlanChange).not.toHaveBeenCalled();
      },
    );

    it('recusa troca de teste sem confirmação explícita antes de chamar Stripe', async () => {
      const { service, createPlanChangeSession } = commandSetup(
        linkedSubscription({
          planCode: PlanCode.ESSENTIAL,
          effectiveStatus: SubscriptionStatus.TRIALING,
        }),
      );
      await expect(
        service.changeSubscriptionPlan({
          organizationId,
          expectedVersion: 7,
          planCode: PlanCode.PROFESSIONAL,
        }),
      ).rejects.toMatchObject({ code: 'BILLING_COMMAND_NOT_ALLOWED' });
      expect(createPlanChangeSession).not.toHaveBeenCalled();
    });
  });

  it.each([
    [PlanCode.PROFESSIONAL, BillingInterval.MONTHLY],
    [PlanCode.ESSENTIAL, BillingInterval.ANNUAL],
  ] as const)(
    'trial para %s/%s abre checkout sem dias gratuitos e preserva assinatura até pagar',
    async (planCode, billingInterval) => {
      const { service, subscriptions, repository, createCheckoutSession } =
        setup();
      subscriptions.requireCurrent.mockResolvedValue({
        ...currentSubscription(),
        planCode: PlanCode.ESSENTIAL,
        effectiveStatus: SubscriptionStatus.TRIALING,
        trialEndsAt: new Date(Date.now() + 20 * 86400000),
      });
      repository.beginCheckoutAttempt.mockResolvedValue({
        attempt: {
          ...checkoutAttempt(),
          planCode,
          billingInterval,
          endsTrial: true,
        },
        created: true,
      });
      await service.changeSubscriptionPlan({
        organizationId,
        expectedVersion: 1,
        planCode,
        billingInterval,
        acknowledgeTrialEnd: true,
      });
      expect(createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          planCode,
          billingInterval,
          trialDays: null,
        }),
      );
      expect(repository.beginCheckoutAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          endsTrial: true,
          subscriptionVersion: 1,
        }),
      );
    },
  );
});
