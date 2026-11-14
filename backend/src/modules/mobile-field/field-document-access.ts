import type { Prisma } from '@prisma/client';
import type { MobileFieldActor } from './mobile-field.service';

export function canManageFieldDocuments(actor: MobileFieldActor): boolean {
  return (
    actor.isOrganizationOwner === true ||
    actor.permissions.some((permission) =>
      ['*', 'operations.manage', 'artifact_executions.manage'].includes(
        permission,
      ),
    )
  );
}

export function fieldOperationAssignment(
  actor: MobileFieldActor,
): Prisma.OperationWhereInput {
  return canManageFieldDocuments(actor)
    ? {}
    : {
        OR: [
          { responsibleFieldTechnicianId: actor.id },
          {
            auxiliaryTechnicians: {
              some: { userId: actor.id, removedAt: null },
            },
          },
        ],
      };
}

/** Applied in addition to organization/unit filters, including direct ID access. */
export function fieldDocumentAccess(
  actor: MobileFieldActor,
): Prisma.FieldArtifactWhereInput {
  if (canManageFieldDocuments(actor)) return {};
  return {
    OR: [
      {
        sourceType: 'RVT_EXECUTION',
        snapshot: {
          path: ['signatures'],
          array_contains: [{ userId: actor.id }],
        },
      },
      {
        sourceType: 'OPERATION',
        artifactExecution: {
          is: {
            deletedAt: null,
            operation: {
              is: { deletedAt: null, ...fieldOperationAssignment(actor) },
            },
          },
        },
      },
      {
        sourceType: { in: ['RVT_EXECUTION', 'PMOC_EQUIPMENT_EXECUTION'] },
        artifactExecution: {
          is: {
            deletedAt: null,
            OR: [
              { responsibleUserId: actor.id },
              { createdById: actor.id },
              { team: { some: { userId: actor.id } } },
            ],
          },
        },
      },
    ],
  };
}
