import type Stripe from 'stripe';
import {
  ProviderBillingState,
  ProviderInvoiceStatus,
  type ProviderInvoice,
  type ProviderSubscription,
} from '../billing.types';
import { recurringObservation } from '../recurring-observation';
import { stripeRecurringTerms } from './stripe-recurring-terms';

const start = new Date('2026-01-01T00:00:00.000Z');
const end = new Date('2026-07-01T00:00:00.000Z');
const observedAt = new Date('2026-01-03T00:00:00.000Z');
const seconds = (value: Date) => value.getTime() / 1000;

function stripeFixture(
  subscriptionOverrides: object = {},
  itemOverrides: object = {},
  priceOverrides: object = {},
) {
  return {
    id: 'sub_synthetic',
    livemode: false,
    currency: 'brl',
    customer: { id: 'cus_synthetic', discount: null },
    discounts: [],
    items: {
      has_more: false,
      data: [
        {
          quantity: 1,
          discounts: [],
          price: {
            unit_amount: 12001,
            unit_amount_decimal: '12001',
            currency: 'brl',
            livemode: false,
            product: 'prod_synthetic',
            billing_scheme: 'per_unit',
            recurring: {
              usage_type: 'licensed',
              interval: 'month',
              interval_count: 6,
            },
            ...priceOverrides,
          },
          ...itemOverrides,
        },
      ],
    },
    ...subscriptionOverrides,
  } as unknown as Stripe.Subscription;
}

function discount(coupon: object, expiry: Date | null = null) {
  return {
    subscription: 'sub_synthetic',
    subscription_item: null,
    start: seconds(start),
    end: expiry && seconds(expiry),
    source: {
      coupon: { livemode: false, percent_off: null, ...coupon },
    },
  };
}

describe('observed Stripe recurring terms', () => {
  it('separates one-off and recurring coupons and keeps fractional minor units exact', () => {
    const once = discount({ duration: 'once', percent_off: 50 });
    expect(stripeRecurringTerms(stripeFixture({ discounts: [once] }))).toEqual({
      currency: 'brl',
      intervalMonths: 6,
      grossPeriodMinor: 12001,
      discount: { scaledMinor: 0, endsAt: null },
    });
    const expiring = discount(
      { duration: 'repeating', percent_off: 12.5 },
      end,
    );
    expect(
      stripeRecurringTerms(stripeFixture({ discounts: [expiring] }))?.discount,
    ).toEqual({
      scaledMinor: 15_001_250,
      endsAt: end.toISOString(),
    });
    const capped = discount({
      duration: 'forever',
      currency: 'brl',
      amount_off: 50_000,
    });
    expect(
      stripeRecurringTerms(stripeFixture({ discounts: [capped] }))?.discount,
    ).toEqual({
      scaledMinor: 120_010_000,
      endsAt: null,
    });
  });

  it('reports incomplete or ambiguous discounts and handles inapplicable product scopes', () => {
    const wrongCurrency = discount({
      duration: 'forever',
      currency: 'usd',
      amount_off: 500,
    });
    const productScoped = discount({
      duration: 'forever',
      percent_off: 20,
      applies_to: { products: ['prod_other'] },
    });
    expect(
      stripeRecurringTerms(stripeFixture({ discounts: [productScoped] }))
        ?.discount,
    ).toEqual({
      scaledMinor: 0,
      endsAt: null,
    });
    expect(
      stripeRecurringTerms(stripeFixture({ discounts: [wrongCurrency] }))
        ?.discount,
    ).toBeNull();
    expect(
      stripeRecurringTerms(stripeFixture({ customer: 'cus_synthetic' }))
        ?.discount,
    ).toBeNull();
    expect(
      stripeRecurringTerms(
        stripeFixture({ customer: { discount: productScoped } }),
      )?.discount,
    ).toBeNull();
    expect(
      stripeRecurringTerms(
        stripeFixture({ discounts: [productScoped, wrongCurrency] }),
      )?.discount,
    ).toBeNull();
    expect(
      stripeRecurringTerms(stripeFixture({}, { discounts: ['di_item'] }))
        ?.discount,
    ).toBeNull();
    expect(stripeRecurringTerms(stripeFixture({}, { quantity: 2 }))).toBeNull();
    expect(
      stripeRecurringTerms(
        stripeFixture({}, {}, { tax_behavior: 'inclusive' }),
      ),
    ).toBeNull();
    expect(stripeRecurringTerms(stripeFixture({ currency: 'usd' }))).toBeNull();
    expect(
      stripeRecurringTerms(stripeFixture({ automatic_tax: { enabled: true } })),
    ).toBeNull();
  });

  it('requires correlated paid invoice and unique confirmed allocations to record payment eligibility', () => {
    const subscription = {
      mode: 'TEST',
      state: ProviderBillingState.ACTIVE,
      providerSubscriptionId: 'sub_synthetic',
      providerCustomerId: 'cus_synthetic',
      providerPriceId: 'price_synthetic',
      latestInvoiceId: 'in_synthetic',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      providerUpdatedAt: observedAt,
      recurringTerms: stripeRecurringTerms(stripeFixture()),
    } as ProviderSubscription;
    const allocation = {
      invoicePaymentId: 'inpay_synthetic',
      paymentIntentId: 'pi_synthetic',
      amountMinor: 8_000,
      currency: 'brl',
      confirmedAt: observedAt.toISOString(),
    };
    const invoice: ProviderInvoice = {
      mode: 'TEST',
      status: ProviderInvoiceStatus.PAID,
      providerInvoiceId: 'in_synthetic',
      providerSubscriptionId: 'sub_synthetic',
      providerCustomerId: 'cus_synthetic',
      number: null,
      currency: 'brl',
      subtotalMinor: 12_001,
      discountMinor: 4_001,
      taxMinor: 0,
      totalMinor: allocation.amountMinor,
      amountDueMinor: allocation.amountMinor,
      amountPaidMinor: allocation.amountMinor,
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
          subscriptionId: 'sub_synthetic',
          priceId: 'price_synthetic',
          periodStart: start,
          periodEnd: end,
        },
      ],
      paymentEvidence: [allocation, allocation],
      periodStart: start,
      periodEnd: end,
      dueAt: null,
      nextPaymentAttemptAt: null,
      finalizedAt: observedAt,
      paidAt: observedAt,
      voidedAt: null,
      markedUncollectibleAt: null,
      providerCreatedAt: start,
      providerObservedAt: observedAt,
    };

    const observed = recurringObservation(subscription, invoice, 'TEST');
    expect(observed).toMatchObject({ paid: true, grossPeriodMinor: 12001 });
    expect(
      recurringObservation(
        subscription,
        { ...invoice, paymentEvidence: [] },
        'TEST',
      )?.paid,
    ).toBe(false);
    expect(
      recurringObservation(
        subscription,
        { ...invoice, providerCustomerId: 'cus_other' },
        'TEST',
      )?.paid,
    ).toBe(false);
    expect(
      recurringObservation(
        subscription,
        { ...invoice, creditNotesMinor: 1 },
        'TEST',
      )?.paid,
    ).toBe(false);
    expect(
      recurringObservation(
        subscription,
        {
          ...invoice,
          paymentEvidence: [
            allocation,
            { ...allocation, amountMinor: 25 },
            allocation,
          ],
        },
        'TEST',
      )?.paid,
    ).toBe(false);
    expect(recurringObservation(subscription, invoice, 'LIVE')).toBeNull();
    expect(
      recurringObservation(
        { ...subscription, currentPeriodStart: new Date(NaN) },
        invoice,
        'TEST',
      ),
    ).toBeNull();
  });
});
