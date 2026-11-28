import type Stripe from 'stripe';
import type { ProviderPromotionTerms } from '../billing.types';
import {
  activateStripePromotion,
  deactivateStripePromotion,
} from './stripe-promotions';

function fixture(override: Partial<ProviderPromotionTerms> = {}) {
  const terms: ProviderPromotionTerms = {
    id: '01900000-0000-7000-8000-000000000001',
    mode: 'TEST',
    percentOff: 20,
    amountOffMinor: null,
    durationMonths: null,
    totalLimit: 10,
    endsAt: new Date(Date.now() + 86_400_000),
    recoverOnly: false,
    prices: [
      {
        planCode: 'PROFESSIONAL',
        billingInterval: 'MONTHLY',
        priceId: 'price_test',
        amountMinor: 15990,
      },
    ],
    ...override,
  };
  const code = 'ORBIT' + terms.id.replaceAll('-', '').toUpperCase();
  const couponId = 'orbit-' + terms.id;
  const expiry = Math.floor(terms.endsAt.getTime() / 1000);
  const metadata = { orbitPromotionId: terms.id };
  const coupon = {
    id: couponId,
    valid: true,
    livemode: false,
    metadata,
    percent_off: terms.percentOff,
    amount_off: terms.amountOffMinor,
    currency: terms.amountOffMinor === null ? null : 'brl',
    redeem_by: expiry,
    max_redemptions: terms.totalLimit,
    duration: terms.durationMonths === null ? 'once' : 'repeating',
    duration_in_months: terms.durationMonths,
  };
  const promo = {
    id: 'promo_fixture',
    active: true,
    livemode: false,
    metadata,
    code,
    promotion: { type: 'coupon', coupon: couponId },
    expires_at: expiry,
    max_redemptions: terms.totalLimit,
  };
  const price = {
    id: 'price_test',
    active: true,
    livemode: false,
    currency: 'brl',
    unit_amount: 15990,
    billing_scheme: 'per_unit',
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    product: { id: 'prod_fixture', active: true, livemode: false },
  };
  const mock = {
    prices: { retrieve: jest.fn().mockResolvedValue(price) },
    coupons: {
      create: jest.fn().mockResolvedValue(coupon),
      retrieve: jest.fn().mockResolvedValue(coupon),
    },
    promotionCodes: {
      list: jest.fn().mockResolvedValue({ has_more: false, data: [] }),
      create: jest.fn().mockResolvedValue(promo),
      retrieve: jest.fn().mockResolvedValue(promo),
      update: jest.fn().mockResolvedValue({ ...promo, active: false }),
    },
  };
  return {
    stripe: mock as unknown as Stripe,
    mock,
    terms,
    promo,
    price,
    couponId,
  };
}

describe('Stripe promotion resources in the installed API contract', () => {
  it('creates one product-restricted percent coupon and promotion code with stable keys', async () => {
    const { stripe, mock, terms, couponId } = fixture();
    await expect(activateStripePromotion(stripe, terms)).resolves.toBe(
      'promo_fixture',
    );
    expect(mock.prices.retrieve).toHaveBeenCalledWith('price_test', {
      expand: ['product'],
    });
    expect(mock.coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: couponId,
        duration: 'once',
        percent_off: 20,
        max_redemptions: 10,
        applies_to: { products: ['prod_fixture'] },
      }),
      { idempotencyKey: `orbit-promotion-coupon:${terms.id}` },
    );
    expect(mock.promotionCodes.create).toHaveBeenCalledWith(
      expect.objectContaining({
        promotion: { type: 'coupon', coupon: couponId },
        max_redemptions: 10,
      }),
      { idempotencyKey: `orbit-promotion-code:${terms.id}` },
    );
  });

  it('uses fixed BRL with Stripe repeating months and rejects a different mode, amount or currency before creating a coupon', async () => {
    const fixed = fixture({
      percentOff: null,
      amountOffMinor: 2000,
      durationMonths: 3,
    });
    await expect(
      activateStripePromotion(fixed.stripe, fixed.terms),
    ).resolves.toBe('promo_fixture');
    expect(fixed.mock.coupons.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount_off: 2000,
        currency: 'brl',
        duration: 'repeating',
        duration_in_months: 3,
      }),
      expect.anything(),
    );
    const mismatches = [
      { livemode: true },
      { unit_amount: 1 },
      { currency: 'usd' },
      { active: false },
    ];
    for (const mismatch of mismatches) {
      const { stripe, mock, terms, price } = fixture();
      mock.prices.retrieve.mockResolvedValueOnce({ ...price, ...mismatch });
      await expect(activateStripePromotion(stripe, terms)).rejects.toThrow(
        'PROMOTION_PRICE_MISMATCH',
      );
      expect(mock.coupons.create).not.toHaveBeenCalled();
    }
  });

  it('finds the committed provider resource after losing the response, even when new writes are disabled', async () => {
    const { stripe, mock, terms, promo, couponId } = fixture();
    mock.promotionCodes.create.mockRejectedValueOnce(
      new Error('connection lost'),
    );
    await expect(activateStripePromotion(stripe, terms)).rejects.toThrow(
      'connection lost',
    );
    mock.promotionCodes.list.mockResolvedValueOnce({
      has_more: false,
      data: [promo],
    });
    await expect(
      activateStripePromotion(stripe, { ...terms, recoverOnly: true }),
    ).resolves.toBe(promo.id);
    expect(mock.coupons.retrieve).toHaveBeenCalledWith(couponId);
    expect(mock.promotionCodes.create).toHaveBeenCalledTimes(1);
    await expect(
      activateStripePromotion(stripe, { ...terms, recoverOnly: true }),
    ).rejects.toThrow('PROMOTION_VERIFY_ONLY');
    expect(mock.coupons.create).toHaveBeenCalledTimes(1);
  });

  it('checks identity before deactivation and treats an already inactive remote code as success', async () => {
    const { stripe, mock, terms, promo } = fixture();
    mock.promotionCodes.retrieve.mockResolvedValueOnce({
      ...promo,
      livemode: true,
    });
    await expect(
      deactivateStripePromotion(stripe, terms, promo.id),
    ).rejects.toThrow('PROMOTION_PROVIDER_MISMATCH');
    expect(mock.promotionCodes.update).not.toHaveBeenCalled();
    await deactivateStripePromotion(stripe, terms, promo.id);
    mock.promotionCodes.retrieve.mockResolvedValueOnce({
      ...promo,
      active: false,
    });
    await deactivateStripePromotion(stripe, terms, promo.id);
    expect(mock.promotionCodes.update).toHaveBeenCalledTimes(1);
    expect(mock.promotionCodes.update).toHaveBeenCalledWith(
      promo.id,
      { active: false },
      { idempotencyKey: `orbit-promotion-close:${terms.id}` },
    );
  });
});
