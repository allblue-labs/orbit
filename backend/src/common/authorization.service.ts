import { Injectable } from '@nestjs/common';

interface PermissionActor {
  readonly permissions: readonly string[];
  readonly isOrganizationOwner: boolean;
}

interface RoleActor {
  readonly roles: readonly string[];
  readonly isOrganizationOwner: boolean;
}

interface DelegatingActor extends PermissionActor {
  readonly allowedSurfaces: readonly string[];
}

interface UnitActor {
  readonly businessUnitIds: readonly string[];
  readonly isOrganizationOwner: boolean;
}

/**
 * Central authority for tenant RBAC decisions.
 *
 * Ownership is structural (`organizations.owner_user_id`), never an assignable
 * role. It bypasses tenant operational/admin RBAC and surface restrictions,
 * but this service deliberately knows nothing about plans or product features.
 * Entitlement guards run afterwards and remain absolute.
 */
@Injectable()
export class AuthorizationService {
  hasPermissions(actor: PermissionActor, required: readonly string[]): boolean {
    if (actor.isOrganizationOwner) return true;
    return (
      actor.permissions.includes('*') ||
      required.every((permission) => actor.permissions.includes(permission))
    );
  }

  hasAnyRole(actor: RoleActor, required: readonly string[]): boolean {
    if (required.length === 0) return true;
    // A tenant owner is not a platform administrator.
    if (actor.isOrganizationOwner && !required.includes('PLATFORM_ADMIN')) {
      return true;
    }
    return required.some((role) => actor.roles.includes(role));
  }

  canDelegate(
    actor: DelegatingActor,
    permissions: readonly string[],
    allowedSurfaces: readonly string[],
  ): boolean {
    if (actor.isOrganizationOwner) return true;
    if (permissions.includes('*')) return false;
    return (
      permissions.every((permission) =>
        actor.permissions.includes(permission),
      ) &&
      allowedSurfaces.every((surface) =>
        actor.allowedSurfaces.includes(surface),
      )
    );
  }

  canAccessUnit(actor: UnitActor, unitId: string): boolean {
    return actor.isOrganizationOwner || actor.businessUnitIds.includes(unitId);
  }
}
