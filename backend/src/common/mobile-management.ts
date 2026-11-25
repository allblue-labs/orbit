import type { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';

/** Stable identifiers stored on a tenant membership, never on a role or JWT. */
export const MOBILE_DELEGATIONS = [
  'operations',
  'quotes',
  'receipts',
  'sales',
  'finance',
  'customers',
  'equipment',
  'pmoc',
  'rvt',
  'authorization',
] as const;
export type MobileDelegation = (typeof MOBILE_DELEGATIONS)[number];
export type MobileManagementArea = MobileDelegation | 'team';

export const MOBILE_MANAGEMENT = Symbol('mobile-management');
const MOBILE_MANAGEMENT_SHARED = Symbol('mobile-management-shared');

/** Legacy field entry points retain their existing surface rules. */
export const MobileManagementShared = () =>
  SetMetadata(MOBILE_MANAGEMENT_SHARED, true);

export function isMobileManagementRequest(
  reflector: Reflector,
  targets: Parameters<Reflector['getAllAndOverride']>[1],
  request: {
    sessionClient?: string;
    header?(name: string): string | undefined;
  },
) {
  return (
    request.sessionClient === 'MOBILE' &&
    Boolean(reflector.getAllAndOverride(MOBILE_MANAGEMENT, targets)) &&
    (!reflector.getAllAndOverride(MOBILE_MANAGEMENT_SHARED, targets) ||
      request.header?.('x-orbit-mobile-management') === '1')
  );
}

/** Allowlisted methods of the canonical controllers that the mobile workspace uses. */
export const MobileManagement = (...areas: MobileManagementArea[]) =>
  SetMetadata(MOBILE_MANAGEMENT, areas);

export const MOBILE_MANAGEMENT_PERMISSIONS: Record<
  MobileManagementArea,
  readonly string[]
> = {
  operations: ['operations.read'],
  quotes: ['quotes.manage'],
  receipts: ['financial.manage'],
  sales: [
    'financial.manage',
    'inventory.manage',
    'artifact_rendering.render',
    'artifact_manifests.read',
  ],
  finance: ['financial.read'],
  customers: ['customers.read'],
  equipment: ['assets.read'],
  pmoc: ['pmoc.read'],
  rvt: ['rvt.read'],
  authorization: ['operations.assign'],
  team: ['organization.members.update'],
};

export function mobileManagementAreas(
  owner: boolean,
  role: string | undefined,
  permissions: readonly string[],
  delegations: readonly string[],
): MobileManagementArea[] {
  const field = role === 'FIELD_TECHNICIAN';
  return (
    Object.keys(MOBILE_MANAGEMENT_PERMISSIONS) as MobileManagementArea[]
  ).filter(
    (area) =>
      owner ||
      (role === 'ADMINISTRATOR' &&
        MOBILE_MANAGEMENT_PERMISSIONS[area].every((permission) =>
          permissions.includes(permission),
        )) ||
      (field && area !== 'team' && delegations.includes(area)),
  );
}
