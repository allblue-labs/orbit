import {
  ProviderBillingState,
  ProviderInvoiceStatus,
  type BillingMode,
  type ProviderInvoice,
  type ProviderSubscription,
} from './billing.types';

export function recurringObservation(
  subscription: ProviderSubscription,
  invoice: ProviderInvoice | null,
  mode: BillingMode,
) {
  const terms = subscription.recurringTerms;
  const start = subscription.currentPeriodStart?.getTime() ?? NaN;
  const end = subscription.currentPeriodEnd?.getTime() ?? NaN;
  const observedAt = subscription.providerUpdatedAt?.getTime() ?? NaN;
  if (
    subscription.mode !== mode ||
    subscription.state !== ProviderBillingState.ACTIVE ||
    !terms ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isFinite(observedAt) ||
    !subscription.providerPriceId
  )
    return null;

  const correctInvoice =
    invoice?.mode === mode &&
    invoice.status === ProviderInvoiceStatus.PAID &&
    invoice.providerInvoiceId === subscription.latestInvoiceId &&
    invoice.providerCustomerId === subscription.providerCustomerId &&
    invoice.providerSubscriptionId === subscription.providerSubscriptionId &&
    invoice.currency === terms.currency &&
    invoice.amountPaidMinor > 0 &&
    invoice.amountRemainingMinor === 0 &&
    invoice.creditNotesMinor === 0 &&
    [
      'subscription_create',
      'subscription_cycle',
      'subscription_update',
    ].includes(invoice.billingReason ?? '') &&
    invoice.subscriptionLines?.some(
      (line) =>
        line.subscriptionId === subscription.providerSubscriptionId &&
        line.priceId === subscription.providerPriceId &&
        line.periodStart.getTime() === start &&
        line.periodEnd.getTime() === end,
    );
  const allocations = new Map<
    string,
    { amount: number; confirmedAt: number }
  >();
  let inconsistent = false;
  if (correctInvoice) {
    for (const evidence of invoice.paymentEvidence ?? []) {
      const confirmedAt = Date.parse(evidence.confirmedAt);
      if (
        evidence.currency === terms.currency &&
        evidence.invoicePaymentId &&
        evidence.paymentIntentId &&
        Number.isInteger(evidence.amountMinor) &&
        evidence.amountMinor > 0 &&
        Number.isFinite(confirmedAt) &&
        confirmedAt <= observedAt
      ) {
        const previous = allocations.get(evidence.invoicePaymentId);
        if (
          previous &&
          (previous.amount !== evidence.amountMinor ||
            previous.confirmedAt !== confirmedAt)
        )
          inconsistent = true;
        allocations.set(evidence.invoicePaymentId, {
          amount: evidence.amountMinor,
          confirmedAt,
        });
      }
    }
  }
  const paid = Boolean(
    correctInvoice &&
    !inconsistent &&
    invoice &&
    Array.from(allocations.values()).reduce(
      (sum, allocation) => sum + allocation.amount,
      0,
    ) === invoice.amountPaidMinor,
  );
  return {
    ...terms,
    mode,
    providerPriceId: subscription.providerPriceId,
    periodStart: new Date(start).toISOString(),
    periodEnd: new Date(end).toISOString(),
    observedAt: new Date(observedAt).toISOString(),
    paid,
  };
}
