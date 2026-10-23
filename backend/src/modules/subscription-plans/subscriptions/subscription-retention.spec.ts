import { SubscriptionService } from './subscription.service';
import { snapshotOf } from './subscription.snapshot';
import { planDefinition } from '../catalog/plan-registry';

function fixture(overrides: Record<string, unknown> = {}) {
  const current = {
    id: 'subscription',
    organizationId: 'org',
    version: 1,
    planCode: 'PROFESSIONAL',
    catalogVersion: 1,
    entitlementsSnapshot: snapshotOf(planDefinition('PROFESSIONAL')),
    status: 'ACTIVE',
    billingInterval: 'MONTHLY',
    billingAnchorAt: new Date('2026-10-01T12:00:00Z'),
    currentPeriodStart: new Date('2026-10-01T12:00:00Z'),
    currentPeriodEnd: new Date('2026-11-01T12:00:00Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    trialStartsAt: null,
    trialEndsAt: null,
    graceStartsAt: null,
    graceEndsAt: null,
    pendingPlanCode: null,
    pendingBillingInterval: null,
    pendingCatalogVersion: null,
    pendingEntitlementsSnapshot: null,
    pendingEffectiveAt: null,
    dataRetentionEndsAt: null,
    ...overrides,
  };
  const repository = {
    findCurrent: jest.fn().mockResolvedValue(current),
    updateIfVersion: jest
      .fn<
        Promise<Record<string, unknown>>,
        [string, number, Record<string, unknown>]
      >()
      .mockImplementation((_id, _version, data) =>
        Promise.resolve({ ...current, ...data }),
      ),
  };
  return {
    repository,
    service: new SubscriptionService(repository as never),
    current,
  };
}

describe('cancellation retention', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  it('keeps paid rights and starts the 30 days at the paid term end', async () => {
    const { service, repository, current } = fixture({
      pendingPlanCode: 'ESSENTIAL',
    });
    await service.cancelAtPeriodEnd('org', 1, true);
    const data = repository.updateIfVersion.mock.calls[0][2];
    expect(data).toMatchObject({
      cancelAtPeriodEnd: true,
      dataRetentionEndsAt: new Date('2026-12-01T12:00:00Z'),
      pendingPlanCode: null,
    });
    expect(data.status).toBeUndefined();
    expect(data.planCode).toBeUndefined();
    expect(data.entitlementsSnapshot).toBeUndefined();
    expect(data.currentPeriodEnd).toBeUndefined();
    expect(current.status).toBe('ACTIVE');
  });

  it('uses the actual trial end when canceling an evaluation', async () => {
    const { service, repository } = fixture({
      status: 'TRIALING',
      trialStartsAt: new Date('2026-10-01T12:00:00Z'),
      trialEndsAt: new Date('2026-10-31T12:00:00Z'),
    });
    await service.cancelAtPeriodEnd('org', 1, true);
    expect(repository.updateIfVersion.mock.calls[0][2]).toMatchObject({
      dataRetentionEndsAt: new Date('2026-11-30T12:00:00Z'),
    });
  });

  it('does not schedule deletion retroactively for a client that did not see the policy', async () => {
    const { service, repository } = fixture();
    await service.cancelAtPeriodEnd('org', 1);
    expect(repository.updateIfVersion.mock.calls[0][2]).toMatchObject({
      cancelAtPeriodEnd: true,
      dataRetentionEndsAt: null,
    });
  });

  it('clears the deletion deadline after successful provider reactivation', async () => {
    const { service, repository } = fixture({
      cancelAtPeriodEnd: true,
      providerSubscriptionId: 'sub_stripe',
      dataRetentionEndsAt: new Date('2026-12-01T12:00:00Z'),
    });
    await service.applyProviderCancellation('org', 1, false);
    expect(repository.updateIfVersion.mock.calls[0][2]).toMatchObject({
      cancelAtPeriodEnd: false,
      dataRetentionEndsAt: null,
    });
  });

  it('keeps the 30-day deadline aligned with the authoritative paid term', async () => {
    const { service, repository } = fixture({
      cancelAtPeriodEnd: true,
      providerSubscriptionId: 'sub_stripe',
      dataRetentionEndsAt: new Date('2026-12-01T12:00:00Z'),
    });
    await service.applyProviderPlan('org', 1, {
      planCode: 'PROFESSIONAL',
      billingInterval: 'MONTHLY',
      period: {
        start: new Date('2026-10-01T12:00:00Z'),
        end: new Date('2026-11-05T12:00:00Z'),
      },
      activate: true,
      cancelAtPeriodEnd: true,
    });
    expect(repository.updateIfVersion.mock.calls[0][2]).toMatchObject({
      dataRetentionEndsAt: new Date('2026-12-05T12:00:00Z'),
    });
  });
});
