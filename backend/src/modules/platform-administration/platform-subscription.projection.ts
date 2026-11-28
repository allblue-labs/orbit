import type { OrganizationSubscription } from '@prisma/client';
import { project } from '../subscription-plans/subscriptions/subscription.projection';
import {
  grantsProductAccess,
  isTerminal,
} from '../subscription-plans/subscriptions/subscription.types';
import {
  isKnownPlan,
  planDefinition,
} from '../subscription-plans/catalog/plan-registry';

export type PlatformSubscriptionSnapshot = Pick<
  OrganizationSubscription,
  | 'id'
  | 'status'
  | 'planCode'
  | 'version'
  | 'billingInterval'
  | 'billingAnchorAt'
  | 'currentPeriodStart'
  | 'currentPeriodEnd'
  | 'trialEndsAt'
  | 'graceStartsAt'
  | 'graceEndsAt'
  | 'pendingEffectiveAt'
  | 'pendingPlanCode'
  | 'pendingBillingInterval'
  | 'cancelAtPeriodEnd'
> & { providerManaged: boolean };

export function platformSubscription(
  row: OrganizationSubscription | undefined,
  at: Date,
) {
  return projectPlatformSubscription(
    row && { ...row, providerManaged: row.providerSubscriptionId !== null },
    at,
  );
}

/** Delegates the clock/rights policy to the product's canonical projector. */
export function projectPlatformSubscription(
  row: PlatformSubscriptionSnapshot | undefined,
  at: Date,
) {
  if (!row)
    return {
      source: 'UNKNOWN_LEGACY' as const,
      status: 'UNKNOWN' as const,
      accessGranted: false,
      planCode: null,
      billingInterval: null,
      version: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialEndsAt: null,
      pendingChange: null,
      cancelAtPeriodEnd: false,
      id: null,
    };
  const state = project(row, at);
  const planCode =
    state.pendingApplied && row.pendingPlanCode
      ? row.pendingPlanCode
      : row.planCode;
  return {
    source: 'CANONICAL' as const,
    id: row.id,
    status: state.status,
    accessGranted: grantsProductAccess(state.status),
    planCode,
    planLabel: isKnownPlan(planCode)
      ? planDefinition(planCode).label
      : planCode,
    billingInterval: state.pendingApplied
      ? (row.pendingBillingInterval ?? row.billingInterval)
      : row.billingInterval,
    version: row.version,
    currentPeriodStart: state.currentPeriodStart,
    currentPeriodEnd: state.currentPeriodEnd,
    trialEndsAt: row.trialEndsAt,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd && !isTerminal(state.status),
    pendingChange:
      row.pendingPlanCode && !state.pendingApplied && !isTerminal(state.status)
        ? {
            planCode: row.pendingPlanCode,
            billingInterval: row.pendingBillingInterval,
            effectiveAt: row.pendingEffectiveAt,
          }
        : null,
  };
}
