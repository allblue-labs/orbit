import type { Prisma } from '@prisma/client';

export const memberPermissionSelection = {
  usesCustomAccess: true,
  customPermissions: true,
  organization: { select: { ownerUserId: true } },
  role: { select: { permissions: true } },
} as const;

type Membership = Prisma.OrganizationMembershipGetPayload<{
  select: typeof memberPermissionSelection;
}>;

/** Matches the identity guard: ownership is a database relation, never a role wildcard. */
export function currentMemberPermissions(
  membership: Membership | null,
  userId: string,
): string[] {
  if (!membership) return [];
  if (membership.organization?.ownerUserId === userId) return ['*'];
  return membership.usesCustomAccess
    ? membership.customPermissions
    : membership.role.permissions;
}
