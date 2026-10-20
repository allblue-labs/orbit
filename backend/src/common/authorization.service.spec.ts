import { AuthorizationService } from './authorization.service';

describe('AuthorizationService', () => {
  const service = new AuthorizationService();

  it('derives tenant-owner authority structurally', () => {
    const owner = {
      permissions: [] as string[],
      roles: ['OWNER'],
      allowedSurfaces: [] as string[],
      businessUnitIds: [] as string[],
      isOrganizationOwner: true,
    };
    expect(service.hasPermissions(owner, ['future.permission'])).toBe(true);
    expect(service.hasAnyRole(owner, ['ADMINISTRATOR'])).toBe(true);
    expect(service.canAccessUnit(owner, 'future-unit')).toBe(true);
    expect(service.canDelegate(owner, ['operations.read'], ['MOBILE'])).toBe(
      true,
    );
    expect(service.hasAnyRole(owner, ['PLATFORM_ADMIN'])).toBe(false);
  });

  it('requires an exact permission and unit for a normal actor', () => {
    const actor = {
      permissions: ['operations.read'],
      businessUnitIds: ['unit-a'],
      isOrganizationOwner: false,
    };
    expect(service.hasPermissions(actor, ['operations.read'])).toBe(true);
    expect(service.hasPermissions(actor, ['operations.update'])).toBe(false);
    expect(service.canAccessUnit(actor, 'unit-a')).toBe(true);
    expect(service.canAccessUnit(actor, 'unit-b')).toBe(false);
  });

  it('prevents privilege and surface escalation during delegation', () => {
    const actor = {
      permissions: ['organization.members.update', 'operations.read'],
      allowedSurfaces: ['WEB'],
      isOrganizationOwner: false,
    };
    expect(service.canDelegate(actor, ['operations.read'], ['WEB'])).toBe(true);
    expect(service.canDelegate(actor, ['financial.manage'], ['WEB'])).toBe(
      false,
    );
    expect(
      service.canDelegate(actor, ['operations.read'], ['WEB', 'MOBILE']),
    ).toBe(false);
    expect(service.canDelegate(actor, ['*'], ['WEB'])).toBe(false);
  });
});
