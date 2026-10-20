import {
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import type { SubscriptionPlanRepository } from './subscription-plan.repository';
import { SubscriptionPlanService } from './subscription-plan.service';

describe('SubscriptionPlanService', () => {
  const repository = {
    getOrganizationEntitlements: jest.fn(),
    listActive: jest.fn(),
    createPlan: jest.fn(),
    updatePlan: jest.fn(),
  };
  const service = new SubscriptionPlanService(
    repository as unknown as SubscriptionPlanRepository,
  );

  beforeEach(() => jest.clearAllMocks());

  it('parses finite limits and preserves unlimited resources', async () => {
    repository.getOrganizationEntitlements.mockResolvedValue({
      id: 'organization-id',
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      currentPeriodStart: new Date('2026-07-01'),
      currentPeriodEnd: new Date('2026-08-01'),
      externalCustomerId: null,
      externalSubscriptionId: null,
      plan: {
        key: 'PRO',
        capabilities: ['business_units.manage'],
        limits: { users: 10, storage: null, invalid: -1 },
      },
    });

    const result = await service.getEntitlements('organization-id');
    expect(result.limits).toEqual({ users: 10, storage: null });
    await expect(
      service.assertCapabilities('organization-id', ['business_units.manage']),
    ).resolves.toBeUndefined();
  });

  it('rejects unavailable capabilities', async () => {
    repository.getOrganizationEntitlements.mockResolvedValue({
      subscriptionStatus: 'ACTIVE',
      currentPeriodStart: new Date('2026-07-01'),
      currentPeriodEnd: new Date('2099-08-01'),
      plan: { key: 'FREE', capabilities: [], limits: {} },
    });

    await expect(
      service.assertCapabilities('organization-id', ['reports.create']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses the canonical subscription instead of stale organization fields', async () => {
    const start = new Date('2026-07-01T00:00:00.000Z');
    const end = new Date('2099-08-01T00:00:00.000Z');
    repository.getOrganizationEntitlements.mockResolvedValue({
      subscriptionStatus: 'TRIALING',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      plan: {
        key: 'PROFESSIONAL',
        capabilities: ['operations.read'],
        limits: {},
      },
      subscriptions: [
        {
          status: 'PENDING_PAYMENT',
          planCode: 'PROFESSIONAL',
          billingInterval: 'MONTHLY',
          billingAnchorAt: start,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          trialEndsAt: null,
          graceStartsAt: null,
          graceEndsAt: null,
          providerSubscriptionId: null,
          cancelAtPeriodEnd: false,
          pendingEffectiveAt: null,
          pendingPlanCode: null,
        },
      ],
    });

    await expect(
      service.getEntitlements('organization-id'),
    ).resolves.toMatchObject({
      planKey: 'PROFESSIONAL',
      subscriptionStatus: 'PENDING_PAYMENT',
    });
  });

  it('keeps access during the bounded payment grace period', () => {
    expect(
      service.grantsAccess({
        planKey: 'PROFESSIONAL',
        subscriptionStatus: 'GRACE_PERIOD',
        capabilities: [],
        limits: {},
        currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('keeps a successful null lookup as not found', async () => {
    repository.getOrganizationEntitlements.mockResolvedValue(null);
    await expect(service.getEntitlements('missing')).rejects.toBeInstanceOf(
      EntityNotFoundException,
    );
  });

  it('does not convert an infrastructure lookup failure to 404', async () => {
    const failure = Object.assign(new Error('connection terminated'), {
      code: 'ECONNRESET',
    });
    repository.getOrganizationEntitlements.mockRejectedValue(failure);
    await expect(service.getEntitlements('organization-id')).rejects.toBe(
      failure,
    );
  });

  it('rejects invalid plan limits before persistence', () => {
    expect(() =>
      service.createPlan({
        key: 'BAD',
        name: 'Invalid',
        limits: { users: -1 },
      }),
    ).toThrow(ValidationException);
    expect(repository.createPlan).not.toHaveBeenCalled();
  });
});
