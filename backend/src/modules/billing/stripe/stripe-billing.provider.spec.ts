import {
  BillingInterval,
  PlanCode,
} from '../../subscription-plans/catalog/plan-catalog.types';
import { BillingMode } from '../billing.types';
import { StripeBillingProvider } from './stripe-billing.provider';

describe('StripeBillingProvider subscription commands', () => {
  const current = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub_test_1',
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
      mode: BillingMode.TEST,
      priceId: jest.fn().mockReturnValue('price_target'),
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
    const invoices = { retrieve: jest.fn() };
    const refunds = { retrieve: jest.fn() };
    const disputes = { retrieve: jest.fn() };
    const invoicePayments = { list: jest.fn() };
    const provider = new StripeBillingProvider(config as never);
    Object.defineProperty(provider, 'client', {
      value: {
        subscriptions,
        subscriptionSchedules,
        invoices,
        refunds,
        disputes,
        invoicePayments,
      },
    });
    return {
      provider,
      subscriptions,
      subscriptionSchedules,
      invoices,
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
    const { provider, subscriptionSchedules } = setup();

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
      data: [{ invoice: 'in_test_1' }],
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
});
