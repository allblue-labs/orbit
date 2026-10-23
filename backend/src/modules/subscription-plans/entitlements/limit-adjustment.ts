import type { EffectiveEntitlements } from './effective-entitlements';
import { limitFor, fromSubscription } from './effective-entitlements';
import type { SubscriptionRow } from '../subscriptions/subscription.repository';
import {
  AllocationResource,
  UsageResource,
  type PlanLimit,
} from '../catalog/plan-catalog.types';

export const LIMIT_ADJUSTMENT_MS = 48 * 60 * 60_000;

export function isReduction(
  previous: EffectiveEntitlements,
  next: EffectiveEntitlements,
): boolean {
  return (
    [...previous.capabilities].some((c) => !next.capabilities.has(c)) ||
    Object.values(AllocationResource).some((r) =>
      lower(limitFor(previous, r), limitFor(next, r)),
    ) ||
    Object.values(UsageResource).some((r) =>
      lower(limitFor(previous, r), limitFor(next, r)),
    )
  );
}
function lower(previous: PlanLimit, next: PlanLimit): boolean {
  return (
    next.kind === 'LIMITED' &&
    (previous.kind === 'UNLIMITED' || previous.value > next.value)
  );
}
export function adjustmentDeadline(
  subscription: Pick<SubscriptionRow, 'limitsChangedAt'>,
): Date | null {
  return subscription.limitsChangedAt
    ? new Date(subscription.limitsChangedAt.getTime() + LIMIT_ADJUSTMENT_MS)
    : null;
}
/** Mantém as cotas anteriores somente durante a adequação. */
export function duringAdjustment(
  current: EffectiveEntitlements,
  subscription: SubscriptionRow,
  at = new Date(),
): EffectiveEntitlements {
  const deadline = adjustmentDeadline(subscription);
  if (!deadline || at >= deadline || !subscription.previousEntitlementsSnapshot)
    return current;
  const previous = fromSubscription(
    current.planCode,
    current.label,
    subscription.previousEntitlementsSnapshot,
    current.accessGranted,
  );
  const maximum = (a: PlanLimit, b: PlanLimit): PlanLimit =>
    a.kind === 'UNLIMITED' || b.kind === 'UNLIMITED'
      ? { kind: 'UNLIMITED' }
      : { kind: 'LIMITED', value: Math.max(a.value, b.value) };
  return {
    ...current,
    allocation: Object.fromEntries(
      Object.values(AllocationResource).map((r) => [
        r,
        maximum(limitFor(current, r), limitFor(previous, r)),
      ]),
    ),
    usage: Object.fromEntries(
      Object.values(UsageResource).map((r) => [
        r,
        maximum(limitFor(current, r), limitFor(previous, r)),
      ]),
    ),
  };
}
