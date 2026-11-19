import type { CommercialPlan } from '../../src/modules/subscription-plans/catalog/commercial-plan.service';
import { planDefinition } from '../../src/modules/subscription-plans/catalog/plan-registry';
import { BillingInterval } from '../../src/modules/subscription-plans/catalog/plan-catalog.types';

export function commercialPlan(
  code: string,
  trialDays = code === 'ESSENTIAL' ? 30 : 0,
): CommercialPlan {
  const plan = planDefinition(code);
  return {
    ...plan,
    version: 1,
    routeCapabilities: [],
    isActive: true,
    tenantId: null,
    trialDays,
    promotion: null,
    prices: Object.fromEntries(
      Object.values(BillingInterval).map((interval) => [
        interval,
        {
          ...plan.prices[interval]!,
          stripePriceId: `price_${code}_${interval}`,
        },
      ]),
    ),
  };
}

export function commercialPlansFixture() {
  return {
    require: jest.fn((code: string) => Promise.resolve(commercialPlan(code))),
    selectable: jest.fn((code: string) =>
      Promise.resolve(commercialPlan(code)),
    ),
  };
}
