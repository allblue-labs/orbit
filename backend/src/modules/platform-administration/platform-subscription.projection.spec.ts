import { platformSubscription } from './platform-subscription.projection';
import type { OrganizationSubscription } from '@prisma/client';

const at = new Date('2026-11-14T12:00:00Z');
const row = (patch: Partial<OrganizationSubscription> = {}) =>
  ({
    id: 'subscription',
    organizationId: 'tenant',
    planCode: 'ESSENTIAL',
    status: 'TRIALING',
    billingInterval: 'MONTHLY',
    billingAnchorAt: at,
    currentPeriodStart: at,
    currentPeriodEnd: new Date('2026-12-14T12:00:00Z'),
    trialEndsAt: new Date('2026-12-14T12:00:00Z'),
    graceStartsAt: null,
    graceEndsAt: null,
    providerSubscriptionId: null,
    cancelAtPeriodEnd: false,
    pendingPlanCode: null,
    pendingEffectiveAt: null,
    version: 1,
    ...patch,
  }) as OrganizationSubscription;

describe('canonical administrative subscription projection', () => {
  it('never infers active access from missing canonical subscription', () => {
    expect(platformSubscription(undefined, at)).toMatchObject({
      source: 'UNKNOWN_LEGACY',
      status: 'UNKNOWN',
      accessGranted: false,
    });
  });
  it('shows unpaid subscriptions as pending without access', () => {
    expect(
      platformSubscription(row({ status: 'PENDING_PAYMENT' }), at),
    ).toMatchObject({ status: 'PENDING_PAYMENT', accessGranted: false });
  });
  it('uses the canonical clock for valid and expired trials', () => {
    expect(platformSubscription(row(), at)).toMatchObject({
      status: 'TRIALING',
      accessGranted: true,
    });
    expect(
      platformSubscription(
        row({ trialEndsAt: new Date('2026-11-13T12:00:00Z') }),
        at,
      ),
    ).toMatchObject({ status: 'EXPIRED', accessGranted: false });
  });
  it('keeps provider-scheduled changes and cancellations separate from the effective plan', () => {
    expect(
      platformSubscription(
        row({
          status: 'ACTIVE',
          providerSubscriptionId: 'sub_fixture',
          pendingPlanCode: 'PROFESSIONAL',
          pendingEffectiveAt: new Date('2026-12-14T12:00:00Z'),
          cancelAtPeriodEnd: true,
        }),
        at,
      ),
    ).toMatchObject({
      status: 'ACTIVE',
      planCode: 'ESSENTIAL',
      cancelAtPeriodEnd: true,
      pendingChange: { planCode: 'PROFESSIONAL' },
    });
  });
  it('does not present already ended contracts as scheduled cancellations or changes', () => {
    expect(
      platformSubscription(
        row({
          status: 'CANCELED',
          cancelAtPeriodEnd: true,
          pendingPlanCode: 'PROFESSIONAL',
          pendingEffectiveAt: new Date('2026-12-14T12:00:00Z'),
        }),
        at,
      ),
    ).toMatchObject({
      status: 'CANCELED',
      accessGranted: false,
      cancelAtPeriodEnd: false,
      pendingChange: null,
    });
  });
});
