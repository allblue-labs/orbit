import type Stripe from 'stripe';
import type { ProviderPromotionTerms } from '../billing.types';

const live = (terms: ProviderPromotionTerms) => terms.mode === 'LIVE';
const remoteCode = (id: string) =>
  `ORBIT${id.replaceAll('-', '')}`.toUpperCase();
const couponCode = (id: string) => `orbit-${id}`;

export async function activateStripePromotion(
  stripe: Stripe,
  terms: ProviderPromotionTerms,
) {
  const code = remoteCode(terms.id);
  const couponId = couponCode(terms.id);
  const expiresAt = Math.floor(terms.endsAt.getTime() / 1000);
  const metadata = { orbitPromotionId: terms.id };
  const promotions = await stripe.promotionCodes.list({ code, limit: 2 });
  if (promotions.has_more || promotions.data.length > 1)
    throw new Error('PROMOTION_PROVIDER_COLLISION');
  const existing = promotions.data[0];
  if (existing) {
    assertStripePromotion(existing, terms, couponId);
    if (!existing.active) throw new Error('PROMOTION_PROVIDER_INACTIVE');
    const coupon = await stripe.coupons.retrieve(couponId);
    assertCoupon(coupon, terms, couponId);
    return existing.id;
  }
  if (terms.recoverOnly || expiresAt <= Date.now() / 1000)
    throw new Error('PROMOTION_VERIFY_ONLY');

  const products = new Set<string>();
  for (const target of terms.prices) {
    const price = await stripe.prices.retrieve(target.priceId, {
      expand: ['product'],
    });
    const product = price.product;
    const months =
      target.billingInterval === 'MONTHLY'
        ? 1
        : target.billingInterval === 'SEMIANNUAL'
          ? 6
          : 12;
    const cadence =
      price.recurring?.interval === 'month'
        ? price.recurring.interval_count
        : price.recurring?.interval === 'year'
          ? 12 * price.recurring.interval_count
          : 0;
    if (
      !price.active ||
      price.id !== target.priceId ||
      price.livemode !== live(terms) ||
      price.currency !== 'brl' ||
      price.unit_amount !== target.amountMinor ||
      cadence !== months ||
      price.billing_scheme !== 'per_unit' ||
      price.recurring?.usage_type !== 'licensed' ||
      typeof product === 'string' ||
      ('deleted' in product && product.deleted) ||
      !('active' in product) ||
      !product.active ||
      product.livemode !== live(terms)
    ) {
      throw new Error('PROMOTION_PRICE_MISMATCH');
    }
    products.add(product.id);
  }

  const coupon = await stripe.coupons.create(
    {
      id: couponId,
      name: 'Orbit',
      ...(terms.percentOff !== null
        ? { percent_off: terms.percentOff }
        : { amount_off: terms.amountOffMinor!, currency: 'brl' }),
      ...(terms.durationMonths === null
        ? { duration: 'once' }
        : { duration: 'repeating', duration_in_months: terms.durationMonths }),
      applies_to: { products: [...products].sort() },
      max_redemptions: terms.totalLimit,
      redeem_by: expiresAt,
      metadata,
    },
    { idempotencyKey: `orbit-promotion-coupon:${terms.id}` },
  );
  assertCoupon(coupon, terms, couponId);
  const promotion = await stripe.promotionCodes.create(
    {
      promotion: { type: 'coupon', coupon: coupon.id },
      code,
      expires_at: expiresAt,
      max_redemptions: terms.totalLimit,
      metadata,
    },
    { idempotencyKey: `orbit-promotion-code:${terms.id}` },
  );
  assertStripePromotion(promotion, terms, couponId);
  if (!promotion.active) throw new Error('PROMOTION_PROVIDER_INACTIVE');
  return promotion.id;
}

export async function deactivateStripePromotion(
  stripe: Stripe,
  terms: ProviderPromotionTerms,
  providerId: string,
) {
  const current = await stripe.promotionCodes.retrieve(providerId);
  const couponId = couponCode(terms.id);
  assertStripePromotion(current, terms, couponId);
  if (!current.active) return;
  const closed = await stripe.promotionCodes.update(
    providerId,
    { active: false },
    { idempotencyKey: `orbit-promotion-close:${terms.id}` },
  );
  assertStripePromotion(closed, terms, couponId);
  if (closed.active) throw new Error('PROMOTION_PROVIDER_STILL_ACTIVE');
}

function assertCoupon(
  coupon: Stripe.Coupon,
  terms: ProviderPromotionTerms,
  id: string,
) {
  if (
    coupon.id !== id ||
    coupon.livemode !== live(terms) ||
    coupon.metadata?.orbitPromotionId !== terms.id ||
    !coupon.valid ||
    coupon.percent_off !== terms.percentOff ||
    coupon.amount_off !== terms.amountOffMinor ||
    (terms.amountOffMinor !== null && coupon.currency !== 'brl') ||
    coupon.max_redemptions !== terms.totalLimit ||
    coupon.redeem_by !== Math.floor(terms.endsAt.getTime() / 1000) ||
    coupon.duration !==
      (terms.durationMonths === null ? 'once' : 'repeating') ||
    coupon.duration_in_months !== terms.durationMonths
  ) {
    throw new Error('PROMOTION_COUPON_MISMATCH');
  }
}

function assertStripePromotion(
  promotion: Stripe.PromotionCode,
  terms: ProviderPromotionTerms,
  couponId: string,
) {
  const coupon = promotion.promotion.coupon;
  if (
    promotion.livemode !== live(terms) ||
    promotion.metadata?.orbitPromotionId !== terms.id ||
    promotion.code.toUpperCase() !== remoteCode(terms.id) ||
    (typeof coupon === 'string' ? coupon : coupon?.id) !== couponId ||
    promotion.max_redemptions !== terms.totalLimit ||
    promotion.expires_at !== Math.floor(terms.endsAt.getTime() / 1000)
  ) {
    throw new Error('PROMOTION_PROVIDER_MISMATCH');
  }
}
