import type Stripe from 'stripe';
import type { ProviderRecurringTerms } from '../billing.types';

const noRecurringDiscount = { scaledMinor: 0, endsAt: null };

export function stripeRecurringTerms(
  subscription: Stripe.Subscription,
): ProviderRecurringTerms | null {
  const item = subscription.items.data[0];
  const price = item?.price;
  const recurring = price?.recurring;
  if (
    subscription.pause_collection ||
    subscription.items.has_more !== false ||
    subscription.items.data.length !== 1 ||
    item?.quantity !== 1 ||
    !price ||
    price.livemode !== subscription.livemode ||
    price.currency !== subscription.currency ||
    price.billing_scheme !== 'per_unit' ||
    price.transform_quantity ||
    price.tax_behavior === 'inclusive' ||
    (subscription.automatic_tax?.enabled &&
      price.tax_behavior !== 'exclusive') ||
    !recurring ||
    recurring.usage_type !== 'licensed' ||
    price.unit_amount === null ||
    !Number.isInteger(price.unit_amount) ||
    price.unit_amount <= 0 ||
    price.unit_amount > 2_147_483_647 ||
    (price.unit_amount_decimal !== null &&
      Number(price.unit_amount_decimal) !== price.unit_amount) ||
    !/^[a-z]{3}$/.test(price.currency)
  )
    return null;
  const months =
    recurring.interval === 'month'
      ? recurring.interval_count
      : recurring.interval === 'year' && recurring.interval_count === 1
        ? 12
        : 0;
  if (months !== 1 && months !== 6 && months !== 12) return null;
  return {
    currency: price.currency,
    intervalMonths: months,
    grossPeriodMinor: price.unit_amount,
    discount: recurringDiscount(subscription, item, price),
  };
}

function recurringDiscount(
  subscription: Stripe.Subscription,
  item: Stripe.SubscriptionItem,
  price: Stripe.Price,
): ProviderRecurringTerms['discount'] {
  // Stripe can inherit a coupon from the customer. An ID alone cannot prove
  // its absence. Stacked and item-level discounts are outside this projection.
  if (
    !Array.isArray(item.discounts) ||
    item.discounts.length ||
    !Array.isArray(subscription.discounts) ||
    subscription.discounts.length > 1 ||
    !subscription.customer ||
    typeof subscription.customer !== 'object' ||
    subscription.customer.deleted ||
    subscription.customer.discount
  )
    return null;
  const discount = subscription.discounts[0];
  if (!discount) return noRecurringDiscount;
  if (
    typeof discount === 'string' ||
    discount.subscription !== subscription.id ||
    discount.subscription_item ||
    !Number.isFinite(discount.start) ||
    discount.start > Date.now() / 1000
  )
    return null;
  const coupon = discount.source?.coupon;
  if (
    !coupon ||
    typeof coupon === 'string' ||
    coupon.livemode !== subscription.livemode
  )
    return null;
  if (coupon.duration === 'once') return noRecurringDiscount;
  if (coupon.duration !== 'repeating' && coupon.duration !== 'forever')
    return null;
  if (coupon.applies_to) {
    const productId =
      typeof price.product === 'string' ? price.product : price.product?.id;
    if (!productId) return null;
    if (!coupon.applies_to.products.includes(productId))
      return noRecurringDiscount;
  }
  const end = discount.end === null ? null : new Date(discount.end * 1000);
  if (
    (coupon.duration === 'repeating' && !end) ||
    (end &&
      (!Number.isFinite(end.getTime()) || discount.end! <= discount.start))
  )
    return null;

  if (coupon.percent_off !== null) {
    const percent = String(coupon.percent_off);
    if (
      !/^\d{1,3}(?:\.\d{1,2})?$/.test(percent) ||
      coupon.percent_off <= 0 ||
      coupon.percent_off > 100
    )
      return null;
    const basisPoints = Math.round(coupon.percent_off * 100);
    return {
      scaledMinor: price.unit_amount! * basisPoints,
      endsAt: end?.toISOString() ?? null,
    };
  }
  if (
    coupon.currency !== price.currency ||
    coupon.amount_off === null ||
    !Number.isSafeInteger(coupon.amount_off) ||
    coupon.amount_off <= 0
  )
    return null;
  return {
    scaledMinor: Math.min(price.unit_amount!, coupon.amount_off) * 10_000,
    endsAt: end?.toISOString() ?? null,
  };
}
