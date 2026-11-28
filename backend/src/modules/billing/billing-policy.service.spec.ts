import { BILLING_DAY_MS, canRefundPurchase } from './billing-policy.service';

describe('prazo de cancelamento com estorno', () => {
  const paid = new Date('2026-11-19T19:00:00Z');

  it.each([
    [-1, false],
    [0, true],
    [7 * BILLING_DAY_MS, true],
    [7 * BILLING_DAY_MS + 1, false],
  ])('decide pelo tempo desde o pagamento (%s ms)', (elapsed, eligible) => {
    expect(canRefundPurchase(paid, new Date(paid.getTime() + elapsed))).toBe(
      eligible,
    );
  });
});
