import 'reflect-metadata';
import type { ExecutionContext, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  AuthenticationGuard,
  PermissionGuard,
  SurfaceGuard,
} from '../../guards/foundation.guards';
import {
  ActivePlanGuard,
  CapabilityGuard,
} from '../subscription-plans/plan-access';
import { NotificationController } from './notification.controller';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationService } from './notification.service';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';

describe('personal notification preferences', () => {
  const service = { preferences: jest.fn(), preference: jest.fn() };
  const controller = new NotificationPreferencesController(service as never);
  const reflector = new Reflector();
  const plans = { getEntitlements: jest.fn(), assertCapabilitiesOn: jest.fn() };
  const authorization = { hasPermissions: jest.fn(() => false) };
  const actor = {
    id: 'operator-a',
    organizationId: 'org-a',
    permissions: [],
    allowedSurfaces: ['MOBILE'],
  };
  const request = { identity: actor, user: actor };
  function context(owner: Type<unknown>, method: string, req = request) {
    const handler: unknown = Object.getOwnPropertyDescriptor(
      owner.prototype,
      method,
    )?.value;
    return {
      getHandler: () => handler,
      getClass: () => owner,
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => jest.clearAllMocks());

  it.each(['preferences', 'setPreference'] as const)(
    'allows an authenticated mobile-only operator without module permissions: %s',
    async (method) => {
      const execution = context(NotificationPreferencesController, method);
      expect(new AuthenticationGuard(reflector).canActivate(execution)).toBe(
        true,
      );
      expect(new SurfaceGuard(reflector).canActivate(execution)).toBe(true);
      expect(
        new PermissionGuard(reflector, authorization as never).canActivate(
          execution,
        ),
      ).toBe(true);
      expect(
        await new CapabilityGuard(reflector, plans as never).canActivate(
          execution,
        ),
      ).toBe(true);
      expect(
        await new ActivePlanGuard(
          reflector,
          plans as never,
          {} as never,
          {} as never,
        ).canActivate(execution),
      ).toBe(true);
      expect(plans.getEntitlements).not.toHaveBeenCalled();
    },
  );

  it('does not open the preferences endpoints to unauthenticated callers', () => {
    const execution = context(
      NotificationPreferencesController,
      'preferences',
      {} as never,
    );
    expect(() =>
      new AuthenticationGuard(reflector).canActivate(execution),
    ).toThrow();
    expect(() => controller.preferences({} as IdentityRequest)).toThrow();
    expect(service.preferences).not.toHaveBeenCalled();
  });

  it('reads and writes preferences only in the authenticated user and tenant scope', async () => {
    const input = { type: 'WORK_ASSIGNED', enabled: false, channels: [] };
    await controller.preferences(request as unknown as IdentityRequest);
    await controller.setPreference(
      request as unknown as IdentityRequest,
      input,
    );
    expect(service.preferences).toHaveBeenCalledWith('org-a', 'operator-a');
    expect(service.preference).toHaveBeenCalledWith(
      'org-a',
      'operator-a',
      input,
    );

    await controller.preferences({
      identity: { id: 'operator-b', organizationId: 'org-b' },
    } as IdentityRequest);
    expect(service.preferences).toHaveBeenLastCalledWith('org-b', 'operator-b');
  });

  it('does not grant reading or managing notifications to an operator without permission', () => {
    for (const method of ['list', 'create', 'dispatch', 'markRead'] as const) {
      const execution = context(NotificationController, method);
      expect(() =>
        new PermissionGuard(reflector, authorization as never).canActivate(
          execution,
        ),
      ).toThrow();
    }
  });

  it('ignores foreign tenant and recipient fields when persisting personal preferences', async () => {
    const upsertPreference = jest.fn().mockResolvedValue({});
    const personal = new NotificationPreferencesController(
      new NotificationService(
        { upsertPreference } as never,
        {} as never,
        {} as never,
        {} as never,
      ),
    );
    await personal.setPreference(
      request as unknown as IdentityRequest,
      {
        type: 'WORK_ASSIGNED',
        enabled: false,
        channels: [],
        organizationId: 'org-b',
        userId: 'operator-b',
        recipientUserId: 'operator-b',
      } as never,
    );
    expect(upsertPreference).toHaveBeenCalledWith(
      'org-a',
      'operator-a',
      'WORK_ASSIGNED',
      {
        enabled: false,
        channels: [],
        quietHours: undefined,
      },
    );
  });
});
