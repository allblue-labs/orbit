import Stripe from 'stripe';
import {
  BillingInterval,
  PlanCode,
} from '../../subscription-plans/catalog/plan-catalog.types';
import { BillingMode } from '../billing.types';
import { BillingConfigurationInvalidException } from '../billing.errors';
import { StripeBillingProvider } from './stripe-billing.provider';

// Keep the paid/trial periods active regardless of the day this suite runs.
beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  jest.setSystemTime(new Date('2026-10-23T12:00:00Z'));
});
afterEach(() => jest.useRealTimers());

describe('StripeBillingProvider subscription commands', () => {
  const current = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub_test_1',
    livemode: false,
    customer: 'cus_test_1',
    status: 'active',
    cancel_at_period_end: false,
    trial_end: null,
    schedule: null,
    metadata: {},
    items: {
      data: [
        {
          id: 'si_test_1',
          price: { id: 'price_old' },
          quantity: 1,
          current_period_start: 1_791_158_400,
          current_period_end: 1_793_836_800,
        },
      ],
    },
    ...overrides,
  });

  const setup = () => {
    const config = {
      enabled: true,
      secretKey: 'sk_test_unit_only',
      webhookSecret: 'whsec_unit_only',
      mode: BillingMode.TEST,
      portalReturnUrl:
        'https://orbit.example.test/configuracoes?secao=assinatura',
      checkoutSuccessUrl:
        'https://orbit.example.test/configuracoes?secao=assinatura&assinatura=sucesso',
      catalogEntryForPrice: jest.fn().mockResolvedValue({
        planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
        billingInterval: BillingInterval.MONTHLY,
        amountMinor: 24990,
      }),
    };
    const subscriptions = {
      retrieve: jest.fn().mockResolvedValue(current()),
      update: jest.fn().mockResolvedValue(
        current({
          metadata: {
            orbitOrganizationId: 'org_1',
            orbitSubscriptionId: 'local_sub_1',
          },
          items: {
            data: [
              {
                id: 'si_test_1',
                price: { id: 'price_target' },
                quantity: 1,
                current_period_start: 1_791_158_400,
                current_period_end: 1_793_836_800,
              },
            ],
          },
        }),
      ),
    };
    const subscriptionSchedules = {
      create: jest.fn().mockResolvedValue({
        id: 'sub_sched_1',
        metadata: {},
        current_phase: { start: 1_791_158_400, end: 1_793_836_800 },
      }),
      retrieve: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: 'sub_sched_1' }),
      release: jest.fn().mockResolvedValue({ id: 'sub_sched_1' }),
    };
    const price = {
      id: 'price_target',
      active: true,
      livemode: false,
      currency: 'brl',
      unit_amount: 24990,
      recurring: { interval: 'month', interval_count: 1 },
    };
    const prices = { retrieve: jest.fn().mockResolvedValue(price) };
    const checkout = {
      sessions: {
        create: jest.fn().mockResolvedValue({
          id: 'cs_unit',
          url: 'https://checkout.stripe.test/c/unit',
          expires_at: 1_793_836_800,
        }),
      },
    };
    const portalConfiguration = {
      id: 'bpc_unit',
      active: true,
      features: {
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price'],
          proration_behavior: 'always_invoice',
          trial_update_behavior: 'end_trial',
          schedule_at_period_end: { conditions: [] },
          products: [{ product: 'prod_unit', prices: ['price_target'] }],
        },
      },
    };
    const billingPortal = {
      configurations: {
        list: jest.fn().mockResolvedValue({ data: [portalConfiguration] }),
        create: jest.fn().mockResolvedValue({ id: 'bpc_orbit_administration' }),
      },
      sessions: {
        create: jest
          .fn()
          .mockResolvedValue({ url: 'https://billing.stripe.test/confirm' }),
      },
    };
    const invoices = { retrieve: jest.fn() };
    const events = {
      list: jest.fn().mockResolvedValue({ data: [], has_more: false }),
    };
    const refunds = { retrieve: jest.fn() };
    const disputes = { retrieve: jest.fn() };
    const invoicePayments = {
      retrieve: jest.fn(),
      list: jest.fn().mockResolvedValue({ data: [], has_more: false }),
    };
    const provider = new StripeBillingProvider(
      config as never,
      {
        selectable: jest.fn().mockResolvedValue({
          prices: {
            MONTHLY: { stripePriceId: 'price_target' },
            ANNUAL: { stripePriceId: 'price_target' },
          },
        }),
      } as never,
    );
    Object.defineProperty(provider, 'client', {
      value: {
        prices,
        billingPortal,
        webhooks: Stripe.webhooks,
        checkout,
        subscriptions,
        subscriptionSchedules,
        invoices,
        events,
        refunds,
        disputes,
        invoicePayments,
      },
    });
    return {
      provider,
      config,
      billingPortal,
      portalConfiguration,
      price,
      prices,
      checkout,
      subscriptions,
      subscriptionSchedules,
      invoices,
      events,
      refunds,
      disputes,
      invoicePayments,
    };
  };

  const input = {
    providerSubscriptionId: 'sub_test_1',
    organizationId: 'org_1',
    subscriptionId: 'local_sub_1',
    planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
    billingInterval: BillingInterval.MONTHLY,
    idempotencyKey: 'orbit:change-plan:stable',
  } as const;

  it('portal geral não oferece troca imediata e reutiliza configuração restrita', async () => {
    const { provider, billingPortal } = setup();
    await provider.createBillingPortalSession({
      providerCustomerId: 'cus_test_1',
    });
    await provider.createBillingPortalSession({
      providerCustomerId: 'cus_test_1',
    });
    expect(billingPortal.configurations.create).toHaveBeenCalledTimes(1);
    expect(billingPortal.configurations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        features: expect.objectContaining({
          subscription_update: { enabled: false },
          subscription_cancel: { enabled: false },
        }) as unknown,
      }),
      expect.anything(),
    );
    expect(billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ configuration: 'bpc_orbit_administration' }),
    );
  });

  it('abre confirmação da assinatura existente sem cobrar ou alterar itens antes da visita', async () => {
    const { provider, billingPortal, subscriptions, config } = setup();
    await expect(
      provider.createPlanChangeSession({
        organizationId: 'org_1',
        providerCustomerId: 'cus_test_1',
        providerSubscriptionId: 'sub_test_1',
        planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
        billingInterval: BillingInterval.MONTHLY,
      }),
    ).resolves.toEqual({ url: 'https://billing.stripe.test/confirm' });
    expect(billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: 'cus_test_1',
        flow_data: {
          type: 'subscription_update_confirm',
          subscription_update_confirm: {
            subscription: 'sub_test_1',
            items: [{ id: 'si_test_1', price: 'price_target', quantity: 1 }],
          },
          after_completion: {
            type: 'redirect',
            redirect: { return_url: config.checkoutSuccessUrl },
          },
        },
      }),
    );
    expect(subscriptions.update).not.toHaveBeenCalled();
  });

  it('recusa configuração que manteria dias grátis em plano não elegível', async () => {
    const { provider, subscriptions, billingPortal, portalConfiguration } =
      setup();
    subscriptions.retrieve.mockResolvedValue(current({ status: 'trialing' }));
    portalConfiguration.features.subscription_update.trial_update_behavior =
      'continue_trial';
    await expect(
      provider.createPlanChangeSession({
        organizationId: 'org_1',
        providerCustomerId: 'cus_test_1',
        providerSubscriptionId: 'sub_test_1',
        planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
        billingInterval: BillingInterval.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(BillingConfigurationInvalidException);
    expect(billingPortal.sessions.create).not.toHaveBeenCalled();
    expect(subscriptions.update).not.toHaveBeenCalled();
  });

  it('recusa portal sem cobrança imediata dos ajustes', async () => {
    const { provider, billingPortal, portalConfiguration } = setup();
    portalConfiguration.features.subscription_update.proration_behavior =
      'none';
    await expect(
      provider.createPlanChangeSession({
        organizationId: 'org_1',
        providerCustomerId: 'cus_test_1',
        providerSubscriptionId: 'sub_test_1',
        planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
        billingInterval: BillingInterval.MONTHLY,
      }),
    ).rejects.toBeInstanceOf(BillingConfigurationInvalidException);
    expect(billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it('verifica o webhook sobre os bytes originais e publica apenas a referência do evento', () => {
    const { provider } = setup();
    const payload = JSON.stringify({
      id: 'evt_unit',
      livemode: false,
      type: 'customer.subscription.updated',
      api_version: '2026-08-26.dahlia',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'sub_unit' } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_unit_only',
    });
    expect(
      provider.verifyWebhook(Buffer.from(payload), signature),
    ).toMatchObject({
      providerEventId: 'evt_unit',
      subscriptionId: 'sub_unit',
      type: 'customer.subscription.updated',
    });
    expect(() =>
      provider.verifyWebhook(
        Buffer.from(payload.replace('sub_unit', 'sub_alterada')),
        signature,
      ),
    ).toThrow(/signature verification failed/);
  });

  it('recusa assinatura de outro segredo de webhook', () => {
    const { provider } = setup();
    const payload = JSON.stringify({
      id: 'evt_unit',
      livemode: false,
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_unit' } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_outro',
    });
    expect(() =>
      provider.verifyWebhook(Buffer.from(payload), signature),
    ).toThrow(/signature verification failed/);
  });

  const checkoutInput = {
    checkoutAttemptId: 'attempt_1',
    organizationId: 'org_1',
    subscriptionId: 'local_sub_1',
    providerCustomerId: 'cus_test_1',
    planCode: PlanCode.PROFESSIONAL_INTELLIGENCE,
    billingInterval: BillingInterval.MONTHLY,
    trialDays: null,
    idempotencyKey: 'checkout-stable',
  };

  it('confere o preço antes de criar checkout e mantém a chave de idempotência', async () => {
    const { provider, prices, checkout } = setup();
    await provider.createCheckoutSession(checkoutInput);
    expect(prices.retrieve).toHaveBeenCalledWith('price_target');
    expect(checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_target', quantity: 1 }],
      }),
      { idempotencyKey: 'checkout-stable' },
    );
    expect(prices.retrieve.mock.invocationCallOrder[0]).toBeLessThan(
      checkout.sessions.create.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    { unit_amount: 1 },
    { currency: 'usd' },
    { active: false },
    { livemode: true },
    { recurring: null },
    { recurring: { interval: 'month', interval_count: 6 } },
  ])(
    'recusa preço divergente antes de checkout ou troca de plano: %j',
    async (patch) => {
      const {
        provider,
        price,
        prices,
        checkout,
        subscriptions,
        subscriptionSchedules,
      } = setup();
      prices.retrieve.mockResolvedValue({ ...price, ...patch });
      await expect(
        provider.createCheckoutSession(checkoutInput),
      ).rejects.toBeInstanceOf(BillingConfigurationInvalidException);
      await expect(
        provider.changePlan({ ...input, timing: 'IMMEDIATE' }),
      ).rejects.toBeInstanceOf(BillingConfigurationInvalidException);
      await expect(
        provider.changePlan({ ...input, timing: 'PERIOD_END' }),
      ).rejects.toBeInstanceOf(BillingConfigurationInvalidException);
      expect(checkout.sessions.create).not.toHaveBeenCalled();
      expect(subscriptions.update).not.toHaveBeenCalled();
      expect(subscriptionSchedules.create).not.toHaveBeenCalled();
    },
  );

  it('não cria checkout quando não consegue verificar o preço', async () => {
    const { provider, prices, checkout } = setup();
    prices.retrieve.mockRejectedValue(new Error('unavailable'));
    await expect(
      provider.createCheckoutSession(checkoutInput),
    ).rejects.toBeDefined();
    expect(checkout.sessions.create).not.toHaveBeenCalled();
  });

  it('cobra upgrade imediatamente e recusa estado incomplete', async () => {
    const { provider, subscriptions } = setup();

    await expect(
      provider.changePlan({ ...input, timing: 'IMMEDIATE' }),
    ).resolves.toMatchObject({ scheduled: false });

    expect(subscriptions.update).toHaveBeenCalledWith(
      'sub_test_1',
      expect.objectContaining({
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        items: [{ id: 'si_test_1', price: 'price_target' }],
      }),
      { idempotencyKey: 'orbit:change-plan:stable' },
    );
  });

  it('preserva o preço atual e agenda downgrade para o fim do período', async () => {
    const { provider, prices, subscriptionSchedules, config } = setup();
    config.catalogEntryForPrice.mockResolvedValue({
      planCode: PlanCode.ESSENTIAL,
      billingInterval: BillingInterval.ANNUAL,
      amountMinor: 59900,
    });
    prices.retrieve.mockResolvedValue({
      id: 'price_target',
      active: true,
      livemode: false,
      currency: 'brl',
      unit_amount: 59900,
      recurring: { interval: 'year', interval_count: 1 },
    });

    const result = await provider.changePlan({
      ...input,
      planCode: PlanCode.ESSENTIAL,
      billingInterval: BillingInterval.ANNUAL,
      timing: 'PERIOD_END',
    });

    expect(result).toMatchObject({
      scheduled: true,
      providerScheduleId: 'sub_sched_1',
      subscription: { providerPriceId: 'price_old' },
    });
    expect(subscriptionSchedules.create).toHaveBeenCalledWith(
      { from_subscription: 'sub_test_1' },
      { idempotencyKey: 'orbit:change-plan:stable:create' },
    );
    expect(subscriptionSchedules.update).toHaveBeenCalledWith(
      'sub_sched_1',
      expect.objectContaining({
        end_behavior: 'release',
        proration_behavior: 'none',
        phases: [
          expect.objectContaining({
            end_date: 1_793_836_800,
            items: [{ price: 'price_old', quantity: 1 }],
          }),
          expect.objectContaining({
            start_date: 1_793_836_800,
            duration: { interval: 'month', interval_count: 12 },
            items: [{ price: 'price_target', quantity: 1 }],
          }),
        ],
      }),
      { idempotencyKey: 'orbit:change-plan:stable:update' },
    );
  });

  it('só desfaz schedule criado para a mesma organização e assinatura', async () => {
    const { provider, subscriptions, subscriptionSchedules } = setup();
    subscriptions.retrieve.mockResolvedValue(
      current({ schedule: 'sub_sched_1' }),
    );
    subscriptionSchedules.retrieve.mockResolvedValue({
      id: 'sub_sched_1',
      metadata: {
        orbitOrganizationId: 'org_1',
        orbitSubscriptionId: 'local_sub_1',
      },
    });

    await provider.cancelScheduledPlanChange({
      providerSubscriptionId: 'sub_test_1',
      organizationId: 'org_1',
      subscriptionId: 'local_sub_1',
      idempotencyKey: 'orbit:cancel-plan-change:stable',
    });

    expect(subscriptionSchedules.release).toHaveBeenCalledWith(
      'sub_sched_1',
      { preserve_cancel_date: true },
      { idempotencyKey: 'orbit:cancel-plan-change:stable' },
    );
  });

  it('normaliza fatura sem PII, client secret ou URL insegura', async () => {
    const { provider, invoices } = setup();
    invoices.retrieve.mockResolvedValue({
      id: 'in_test_1',
      livemode: false,
      customer: 'cus_test_1',
      parent: {
        subscription_details: { subscription: 'sub_test_1' },
      },
      number: 'ORBIT-0001',
      status: 'paid',
      currency: 'BRL',
      subtotal: 14990,
      total_discount_amounts: [{ amount: 1000 }],
      total_taxes: [{ amount: 900 }],
      total: 14890,
      amount_due: 14890,
      amount_paid: 14890,
      amount_remaining: 0,
      pre_payment_credit_notes_amount: 0,
      post_payment_credit_notes_amount: 500,
      attempted: true,
      attempt_count: 1,
      billing_reason: 'subscription_cycle',
      collection_method: 'charge_automatically',
      hosted_invoice_url: 'https://invoice.stripe.test/i/ORBIT-0001',
      invoice_pdf: 'javascript:alert(1)',
      period_start: 1_791_158_400,
      period_end: 1_793_836_800,
      due_date: null,
      next_payment_attempt: null,
      status_transitions: {
        finalized_at: 1_791_158_400,
        paid_at: 1_791_158_500,
        voided_at: null,
        marked_uncollectible_at: null,
      },
      created: 1_791_158_400,
      confirmation_secret: { client_secret: 'pi_secret_must_not_leak' },
      customer_email: 'private@example.test',
    });

    const invoice = await provider.retrieveInvoice('in_test_1');

    expect(invoice).toMatchObject({
      providerInvoiceId: 'in_test_1',
      providerSubscriptionId: 'sub_test_1',
      providerCustomerId: 'cus_test_1',
      status: 'PAID',
      currency: 'brl',
      discountMinor: 1000,
      taxMinor: 900,
      creditNotesMinor: 500,
      invoicePdfUrl: null,
    });
    expect(JSON.stringify(invoice)).not.toContain('pi_secret_must_not_leak');
    expect(JSON.stringify(invoice)).not.toContain('private@example.test');
  });

  it('correlaciona reembolso à fatura pelo payment intent', async () => {
    const { provider, refunds, invoicePayments } = setup();
    refunds.retrieve.mockResolvedValue({
      id: 're_test_1',
      payment_intent: 'pi_test_1',
      status: 'succeeded',
      amount: 5000,
      currency: 'BRL',
      reason: 'requested_by_customer',
      failure_reason: undefined,
      pending_reason: undefined,
      created: 1_791_158_500,
      receipt_number: 'secret_receipt_not_projected',
    });
    invoicePayments.list.mockResolvedValue({
      data: [{ invoice: 'in_test_1', livemode: false }],
      has_more: false,
    });

    const adjustment = await provider.retrieveFinancialAdjustment(
      'REFUND',
      're_test_1',
    );

    expect(adjustment).toMatchObject({
      type: 'REFUND',
      providerObjectId: 're_test_1',
      providerInvoiceId: 'in_test_1',
      status: 'SUCCEEDED',
      amountMinor: 5000,
      currency: 'brl',
      reason: 'requested_by_customer',
    });
    expect(JSON.stringify(adjustment)).not.toContain(
      'secret_receipt_not_projected',
    );
  });
  const cashInvoice = () => ({
    id: 'in_cash',
    livemode: false,
    customer: 'cus_test_1',
    parent: { subscription_details: { subscription: 'sub_test_1' } },
    number: null,
    status: 'paid',
    currency: 'brl',
    subtotal: 5000,
    total: 5000,
    amount_due: 5000,
    amount_paid: 5000,
    amount_remaining: 0,
    pre_payment_credit_notes_amount: 0,
    post_payment_credit_notes_amount: 0,
    attempted: true,
    attempt_count: 1,
    billing_reason: 'subscription_cycle',
    collection_method: 'charge_automatically',
    period_start: 1791158400,
    period_end: 1793836800,
    due_date: null,
    next_payment_attempt: null,
    status_transitions: {
      finalized_at: 1791158400,
      paid_at: 1791158500,
      voided_at: null,
      marked_uncollectible_at: null,
    },
    created: 1791158400,
  });
  const cashPayment = () => ({
    id: 'inpay_cash',
    invoice: 'in_cash',
    livemode: false,
    status: 'paid',
    amount_paid: 5000,
    currency: 'brl',
    status_transitions: { paid_at: 1791158500 },
    payment: {
      type: 'payment_intent',
      payment_intent: {
        id: 'pi_cash',
        status: 'succeeded',
        customer: 'cus_test_1',
        currency: 'brl',
        amount_received: 5000,
        livemode: false,
      },
    },
  });
  it('PAID and a payment record alone do not assert Stripe cash', async () => {
    const { provider, invoices, invoicePayments } = setup();
    invoices.retrieve.mockResolvedValue(cashInvoice());
    invoicePayments.list.mockResolvedValue({
      data: [
        {
          ...cashPayment(),
          payment: { type: 'payment_record', payment_record: 'pyr_external' },
        },
      ],
      has_more: false,
    });
    expect((await provider.retrieveInvoice('in_cash')).paymentEvidence).toEqual(
      [],
    );
  });
  it('records only a succeeded, correlated Stripe PaymentIntent and original paid timestamp', async () => {
    const { provider, invoices, invoicePayments } = setup();
    invoices.retrieve.mockResolvedValue(cashInvoice());
    invoicePayments.list.mockResolvedValue({
      data: [cashPayment()],
      has_more: false,
    });
    expect((await provider.retrieveInvoice('in_cash')).paymentEvidence).toEqual(
      [
        {
          invoicePaymentId: 'inpay_cash',
          paymentIntentId: 'pi_cash',
          amountMinor: 5000,
          currency: 'brl',
          confirmedAt: new Date(1791158500000).toISOString(),
        },
      ],
    );
  });
  it.each(['WRONG_CUSTOMER', 'PROCESSING', 'SHORT_AMOUNT', 'WRONG_CURRENCY'])(
    'does not assert cash without valid payment evidence: %s',
    async (scenario) => {
      const { provider, invoices, invoicePayments } = setup();
      invoices.retrieve.mockResolvedValue(cashInvoice());
      const payment = cashPayment();
      if (scenario === 'WRONG_CUSTOMER')
        payment.payment.payment_intent.customer = 'cus_other';
      if (scenario === 'PROCESSING')
        payment.payment.payment_intent.status = 'processing';
      if (scenario === 'SHORT_AMOUNT')
        payment.payment.payment_intent.amount_received = 1;
      if (scenario === 'WRONG_CURRENCY')
        payment.payment.payment_intent.currency = 'usd';
      invoicePayments.list.mockResolvedValue({
        data: [payment],
        has_more: false,
      });
      expect(
        (await provider.retrieveInvoice('in_cash')).paymentEvidence,
      ).toEqual([]);
    },
  );
  it('fails closed for a LIVE invoice in a TEST provider', async () => {
    const { provider, invoices } = setup();
    invoices.retrieve.mockResolvedValue({ ...cashInvoice(), livemode: true });
    await expect(provider.retrieveInvoice('in_cash')).rejects.toThrow(
      'BILLING_MODE_MISMATCH',
    );
  });
  it('fails closed on unbounded payment pagination', async () => {
    const { provider, invoices, invoicePayments } = setup();
    invoices.retrieve.mockResolvedValue(cashInvoice());
    invoicePayments.list.mockResolvedValue({
      data: [cashPayment()],
      has_more: true,
    });
    await expect(provider.retrieveInvoice('in_cash')).rejects.toThrow(
      'BILLING_PAYMENT_PAGE_LIMIT',
    );
    expect(invoicePayments.list).toHaveBeenCalledTimes(3);
  });
  it('discovers bounded Stripe event history with original occurrence time and cursor', async () => {
    const { provider, events } = setup();
    events.list.mockResolvedValue({
      data: [
        {
          id: 'evt_recovered',
          type: 'invoice.paid',
          livemode: false,
          created: 1791158500,
          api_version: '2026-08-26.dahlia',
          data: {
            object: {
              id: 'in_cash',
              parent: { subscription_details: { subscription: 'sub_test_1' } },
            },
          },
        },
      ],
      has_more: true,
    });
    const from = new Date('2026-10-01'),
      through = new Date('2026-10-02');
    const page = await provider.listRecoveryEvents({
      from,
      through,
      after: 'evt_after',
      limit: 25,
    });
    expect(events.list).toHaveBeenCalledWith({
      created: {
        gte: Math.floor(from.getTime() / 1000),
        lte: Math.floor(through.getTime() / 1000),
      },
      starting_after: 'evt_after',
      limit: 25,
    });
    expect(page.events[0]).toMatchObject({
      mode: 'TEST',
      providerEventId: 'evt_recovered',
      objectId: 'in_cash',
      subscriptionId: 'sub_test_1',
      createdAt: new Date(1791158500000),
    });
    expect(page.hasMore).toBe(true);
  });
  it('rejects a signed LIVE webhook in TEST mode', () => {
    const { provider } = setup();
    const payload = JSON.stringify({
      id: 'evt_live',
      type: 'invoice.paid',
      livemode: true,
      data: { object: { id: 'in_live' } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_unit_only',
    });
    expect(() =>
      provider.verifyWebhook(Buffer.from(payload), signature),
    ).toThrow('mode mismatch');
  });
  it('correlates invoice_payment.paid through the authoritative InvoicePayment', async () => {
    const { provider, invoicePayments } = setup();
    invoicePayments.retrieve.mockResolvedValue({
      invoice: 'in_cash',
      livemode: false,
    });
    await expect(
      provider.retrieveInvoicePaymentInvoice('inpay_cash'),
    ).resolves.toBe('in_cash');
    invoicePayments.retrieve.mockResolvedValue({
      invoice: 'in_live',
      livemode: true,
    });
    await expect(
      provider.retrieveInvoicePaymentInvoice('inpay_live'),
    ).rejects.toThrow('BILLING_MODE_MISMATCH');
  });
});
