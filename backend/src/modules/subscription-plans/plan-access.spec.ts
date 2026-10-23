import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { ForbiddenException } from '../../exceptions';
import {
  ActivePlanGuard,
  ACTIVE_PLAN_KEY,
  CapabilityGuard,
  REQUIRED_CAPABILITIES_KEY,
} from './plan-access';
import type { SubscriptionPlanService } from './subscription-plan.service';

describe('CapabilityGuard error semantics', () => {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === REQUIRED_CAPABILITIES_KEY ? ['inventory.read'] : false,
    ),
  };
  const plans = {
    getEntitlements: jest.fn(),
    assertCapabilitiesOn: jest.fn(),
  };
  const request = () => ({
    id: 'request-id',
    method: 'GET',
    path: '/inventory',
    identity: {
      id: 'user-id',
      organizationId: 'organization-id',
      businessUnitIds: ['unit-id'],
    },
  });
  const context = (value: ReturnType<typeof request>) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => value }),
    }) as unknown as ExecutionContext;
  const guard = new CapabilityGuard(
    reflector as unknown as Reflector,
    plans as unknown as SubscriptionPlanService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    plans.assertCapabilitiesOn.mockReset();
  });

  it('keeps a policy denial as 403', async () => {
    plans.getEntitlements.mockResolvedValue({ capabilities: [] });
    plans.assertCapabilitiesOn.mockImplementation(() => {
      throw new ForbiddenException('missing capability');
    });
    await expect(guard.canActivate(context(request()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rethrows capability lookup infrastructure failures', async () => {
    const failure = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    });
    plans.getEntitlements.mockRejectedValue(failure);
    await expect(guard.canActivate(context(request()))).rejects.toBe(failure);
  });

  it('memoizes only inside one request object', async () => {
    plans.assertCapabilitiesOn.mockImplementation(() => undefined);
    plans.getEntitlements.mockResolvedValue({ capabilities: ['*'] });
    await guard.canActivate(context(request()));
    await guard.canActivate(context(request()));
    expect(plans.getEntitlements).toHaveBeenCalledTimes(2);
  });
});

// O acesso de quem ainda não pagou é distinto do histórico de quem já usou.
describe('ActivePlanGuard initial payment', () => {
  const make = (status: string, method: string, required = true) => {
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === ACTIVE_PLAN_KEY ? required : false,
    };
    const plans = {
      getEntitlements: jest
        .fn()
        .mockResolvedValue({ subscriptionStatus: status }),
      grantsAccess: jest.fn().mockReturnValue(false),
    };
    const guard = new ActivePlanGuard(
      reflector as unknown as Reflector,
      plans as unknown as SubscriptionPlanService,
    );
    const request = {
      method,
      identity: { id: 'owner', organizationId: 'org', businessUnitIds: [] },
    };
    const context = {
      getHandler: () => null,
      getClass: () => null,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard, context };
  };
  it.each(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'])(
    'pending subscription blocks %s in product routes',
    async (method) => {
      const { guard, context } = make('PENDING_PAYMENT', method);
      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: 'SUBSCRIPTION_PAYMENT_REQUIRED',
      });
    },
  );
  it('keeps billing and profile routes reachable without product access metadata', async () => {
    const { guard, context } = make('PENDING_PAYMENT', 'POST', false);
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
  it('keeps read access to the history of an expired subscription', async () => {
    const { guard, context } = make('EXPIRED', 'GET');
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
