import { PlanCapability } from './catalog/plan-catalog.types';
import {
  ProductAccessService,
  ProductFeature,
} from './product-access';
import type { EntitlementService } from './entitlements/entitlement.service';

describe('ProductAccessService', () => {
  const entitlements = {
    hasCapability: jest.fn(),
    assertCapability: jest.fn(),
    resolve: jest.fn(),
  } as unknown as EntitlementService;
  const service = new ProductAccessService(entitlements);

  beforeEach(() => jest.clearAllMocks());

  it('combines entitlement with implementation availability', async () => {
    jest.mocked(entitlements.hasCapability).mockResolvedValue(true);
    await expect(
      service.canUse(
        'organization',
        PlanCapability.ORBIT_INTELLIGENCE,
        ProductFeature.ORBIT_INTELLIGENCE,
      ),
    ).resolves.toBe(true);
    await expect(
      service.canUse(
        'organization',
        PlanCapability.ORBIT_INTELLIGENCE,
        ProductFeature.SCHEDULING_INTELLIGENCE,
      ),
    ).resolves.toBe(false);
  });

  it('does not infer access from a plan name', async () => {
    jest.mocked(entitlements.hasCapability).mockResolvedValue(false);
    await expect(
      service.canUse(
        'organization',
        PlanCapability.ORBIT_INTELLIGENCE,
        ProductFeature.ORBIT_INTELLIGENCE,
      ),
    ).resolves.toBe(false);
  });
});
