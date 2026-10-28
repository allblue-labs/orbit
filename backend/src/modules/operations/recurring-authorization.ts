import type { Prisma } from '@prisma/client';
import { requiresAssignmentAuthorization } from './operation-authorization';

export async function assignmentAuthorizationRequired(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<boolean> {
  const organization = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  return requiresAssignmentAuthorization(organization?.settings);
}

export function managesRecurringAssignments(
  actor: { isOrganizationOwner?: boolean; permissions: readonly string[] },
  kind: 'RVT' | 'PMOC',
): boolean {
  return (
    actor.isOrganizationOwner === true ||
    actor.permissions.includes('*') ||
    actor.permissions.includes(kind === 'RVT' ? 'rvt.manage' : 'pmoc.manage')
  );
}
