import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PUBLIC_KEY, SURFACES_KEY } from '../decorators';
import { SurfaceGuard } from './foundation.guards';

const actor = (allowedSurfaces: readonly string[]) => ({
  id: '0199a9d0-7da0-7000-8000-000000000001',
  roles: [],
  permissions: [],
  businessUnitIds: [],
  allowedSurfaces,
  isOrganizationOwner: false,
});

function fixture(
  allowedSurfaces: readonly string[] | null,
  metadata: Readonly<Record<string, readonly string[] | boolean | undefined>>,
) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
  const request = allowedSurfaces ? { user: actor(allowedSurfaces) } : {};
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { guard: new SurfaceGuard(reflector), context };
}

describe('SurfaceGuard', () => {
  it('treats authenticated product APIs as WEB/API by default', () => {
    const mobile = fixture(['MOBILE'], {});
    expect(() => mobile.guard.canActivate(mobile.context)).toThrow(
      'Client surface is not allowed',
    );

    const web = fixture(['WEB'], {});
    expect(web.guard.canActivate(web.context)).toBe(true);
  });

  it('allows MOBILE only when the endpoint declares it', () => {
    const mobile = fixture(['MOBILE'], { [SURFACES_KEY]: ['MOBILE'] });
    expect(mobile.guard.canActivate(mobile.context)).toBe(true);
  });

  it('does not apply a product surface to public endpoints', () => {
    const publicEndpoint = fixture(null, { [PUBLIC_KEY]: true });
    expect(publicEndpoint.guard.canActivate(publicEndpoint.context)).toBe(true);
  });
});
