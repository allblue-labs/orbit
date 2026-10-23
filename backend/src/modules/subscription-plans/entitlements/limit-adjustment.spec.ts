import { fromCatalog } from './effective-entitlements';
import { planDefinition } from '../catalog/plan-registry';
import { snapshotOf } from '../subscriptions/subscription.snapshot';
import {
  adjustmentDeadline,
  duringAdjustment,
  isReduction,
} from './limit-adjustment';
import { EntitlementService } from './entitlement.service';
import { EntitlementMapper } from './entitlement.mapper';
import { EntitlementMetrics } from './entitlement.metrics';

const changedAt = new Date('2026-11-23T10:00:00Z');
const deadline = new Date('2026-11-25T10:00:00Z');
const essential = fromCatalog(planDefinition('ESSENTIAL'));
const professional = fromCatalog(planDefinition('PROFESSIONAL'));
const subscription = {
  planCode: 'ESSENTIAL',
  effectiveStatus: 'ACTIVE',
  providerSubscriptionId: 'sub_1',
  entitlementsSnapshot: snapshotOf(planDefinition('ESSENTIAL')),
  limitsChangedAt: changedAt,
  previousEntitlementsSnapshot: snapshotOf(planDefinition('PROFESSIONAL')),
  pendingEffectiveAt: null,
  billingAnchorAt: changedAt,
};

describe('adequação de limites após a renovação', () => {
  afterEach(() => jest.useRealTimers());
  it('identifica reduções por cotas e preserva melhorias', () => {
    expect(isReduction(professional, essential)).toBe(true);
    expect(isReduction(essential, professional)).toBe(false);
    expect(isReduction(essential, essential)).toBe(false);
  });
  it('mantém cotas anteriores até o último milissegundo e aplica as novas exatamente após 48 horas', () => {
    expect(adjustmentDeadline(subscription)).toEqual(deadline);
    expect(
      duringAdjustment(
        essential,
        subscription as never,
        new Date(deadline.getTime() - 1),
      ).allocation.PLATFORM_USERS,
    ).toEqual(professional.allocation.PLATFORM_USERS);
    expect(
      duringAdjustment(essential, subscription as never, deadline).allocation
        .PLATFORM_USERS,
    ).toEqual(essential.allocation.PLATFORM_USERS);
  });
  it('publica limite contratado e aviso durante o prazo; bloqueia operações vencidas e libera após regularização sem alterar registros', async () => {
    jest.useFakeTimers().setSystemTime(new Date(deadline.getTime() - 1));
    let users = 10;
    const repository = {
      countAllocation: jest.fn((_org, resource) =>
        Promise.resolve(resource === 'PLATFORM_USERS' ? users : 0),
      ),
      sumUsage: jest.fn().mockResolvedValue(0),
    };
    const service = new EntitlementService(
      repository as never,
      { currentOrNull: jest.fn().mockResolvedValue(subscription) } as never,
      {} as never,
      {} as never,
      new EntitlementMetrics(),
      new EntitlementMapper(),
    );
    const before = await service.describe('org');
    expect(
      before.allocation.find((r) => r.resource === 'PLATFORM_USERS')?.limit,
    ).toEqual({ unlimited: false, value: 5 });
    expect(before.limitAdjustment).toMatchObject({
      blocked: false,
      deadline: deadline.toISOString(),
    });
    await expect(
      service.assertWithinAdjustedAllocation('org', 'OPERATIONS'),
    ).resolves.toBeUndefined();
    jest.setSystemTime(deadline);
    expect((await service.describe('org')).limitAdjustment?.blocked).toBe(true);
    await expect(
      service.assertWithinAdjustedAllocation('org', 'OPERATIONS'),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED' });
    users = 5;
    await expect(
      service.assertWithinAdjustedAllocation('org', 'OPERATIONS'),
    ).resolves.toBeUndefined();
    expect((await service.describe('org')).limitAdjustment).toBeNull();
  });
});
