import { Injectable } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { assignmentAuthorizationRequired } from './recurring-authorization';
import type {
  RecurringAuthorizationQueryDto,
  RecurringAuthorizationTargetDto,
} from './dto/recurring-authorization.dto';

interface Actor {
  id: string;
  organizationId: string;
  businessUnitIds: readonly string[];
}
export interface RecurringAuthorizationItem {
  id: string;
  kind: 'RVT' | 'PMOC';
  parentId: string;
  code: string;
  title: string;
  scheduledStart: string | null;
  version: string;
  responsibleFieldTechnician: { id: string; displayName: string } | null;
}

@Injectable()
export class RecurringAuthorizationService {
  constructor(private readonly rls: RlsTransaction) {}

  list(actor: Actor, query: RecurringAuthorizationQueryDto) {
    return this.rls.run(async (tx) => {
      const unitIds = query.businessUnitId
        ? actor.businessUnitIds.filter((id) => id === query.businessUnitId)
        : [...actor.businessUnitIds];
      if (!(await assignmentAuthorizationRequired(tx, actor.organizationId)))
        return {
          data: [],
          meta: { page: query.page, limit: 50, total: 0, totalPages: 0 },
        };
      const search = query.search?.trim();
      const rvtWhere = {
        organizationId: actor.organizationId,
        businessUnitId: { in: unitIds },
        deletedAt: null,
        authorizedAt: null,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        responsibleFieldTechnicianId: query.assignedUserId ?? { not: null },
        configuration: {
          deletedAt: null,
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { code: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
      };
      const pmocWhere = {
        organizationId: actor.organizationId,
        authorizedAt: null,
        status: 'PENDING',
        plan: {
          businessUnitId: { in: unitIds },
          deletedAt: null,
          status: 'ACTIVE',
          schedulingPaused: false,
          technicianUserId: query.assignedUserId ?? { not: null },
          ...(search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { code: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
      };
      const take = query.page * 50;
      const visits = await tx.rvtOccurrence.findMany({
        where: rvtWhere,
        take,
        orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }],
        include: {
          configuration: { select: { id: true, name: true, code: true } },
        },
      });
      const cycles = await tx.pmocExecution.findMany({
        where: pmocWhere,
        take,
        orderBy: [{ dueOn: 'asc' }, { id: 'asc' }],
        include: {
          plan: {
            select: {
              id: true,
              name: true,
              code: true,
              technicianUserId: true,
            },
          },
        },
      });
      const total =
        (await tx.rvtOccurrence.count({ where: rvtWhere })) +
        (await tx.pmocExecution.count({ where: pmocWhere }));
      const ids = [
        ...visits.map((row) => row.responsibleFieldTechnicianId),
        ...cycles.map((row) => row.plan.technicianUserId),
      ].filter((id): id is string => !!id);
      const users = await tx.user.findMany({
        where: { id: { in: [...new Set(ids)] } },
        select: { id: true, displayName: true },
      });
      const people = new Map(users.map((user) => [user.id, user]));
      const rows: RecurringAuthorizationItem[] = [
        ...visits.map((row) => ({
          id: row.id,
          kind: 'RVT' as const,
          parentId: row.configurationId,
          code: `${row.configuration.code} · visita ${row.sequenceNumber}`,
          title: row.configuration.name,
          scheduledStart: row.scheduledFor?.toISOString() ?? null,
          version: row.updatedAt.toISOString(),
          responsibleFieldTechnician:
            people.get(row.responsibleFieldTechnicianId ?? '') ?? null,
        })),
        ...cycles.map((row) => ({
          id: row.id,
          kind: 'PMOC' as const,
          parentId: row.planId,
          code: `${row.plan.code} · ciclo ${row.sequenceNumber}`,
          title: row.plan.name,
          scheduledStart: row.dueOn.toISOString().slice(0, 10),
          version: row.updatedAt.toISOString(),
          responsibleFieldTechnician:
            people.get(row.plan.technicianUserId ?? '') ?? null,
        })),
      ];
      rows.sort(
        (a, b) =>
          (a.scheduledStart ?? '9999').localeCompare(
            b.scheduledStart ?? '9999',
          ) || a.id.localeCompare(b.id),
      );
      return {
        data: rows.slice((query.page - 1) * 50, take),
        meta: {
          page: query.page,
          limit: 50,
          total,
          totalPages: Math.ceil(total / 50),
        },
      };
    });
  }

  authorize(actor: Actor, items: readonly RecurringAuthorizationTargetDto[]) {
    return this.rls.run(async (tx) => {
      if (!(await assignmentAuthorizationRequired(tx, actor.organizationId)))
        throw new ValidationException(
          'O fluxo de autorização está desligado nesta organização.',
        );
      const now = new Date();
      let authorized = 0;
      for (const item of items) {
        const stamp = { authorizedAt: now, authorizedById: actor.id };
        if (item.kind === 'RVT') {
          await tx.$executeRaw`SELECT id FROM rvt_occurrences WHERE id=${item.id}::uuid AND organization_id=${actor.organizationId}::uuid FOR UPDATE`;
          const visit = await tx.rvtOccurrence.findFirst({
            where: {
              id: item.id,
              organizationId: actor.organizationId,
              businessUnitId: { in: [...actor.businessUnitIds] },
              deletedAt: null,
              configuration: { deletedAt: null },
            },
            include: { execution: { select: { operationId: true } } },
          });
          if (!visit) throw new EntityNotFoundException('Visita RVT', item.id);
          if (visit.authorizedAt) continue;
          if (
            !visit.responsibleFieldTechnicianId ||
            !['SCHEDULED', 'IN_PROGRESS'].includes(visit.status)
          )
            throw new ConflictException(
              'A visita precisa estar atribuída e aberta para autorização.',
            );
          const changed = await tx.rvtOccurrence.updateMany({
            where: {
              id: visit.id,
              organizationId: actor.organizationId,
              updatedAt: new Date(item.version),
            },
            data: stamp,
          });
          if (!changed.count)
            throw new ConflictException(
              'A visita foi alterada. Atualize a fila antes de autorizar.',
            );
          if (visit.execution?.operationId)
            await tx.operation.updateMany({
              where: {
                id: visit.execution.operationId,
                organizationId: actor.organizationId,
              },
              data: stamp,
            });
        } else {
          await tx.$executeRaw`SELECT id FROM pmoc_executions WHERE id=${item.id}::uuid AND organization_id=${actor.organizationId}::uuid FOR UPDATE`;
          const cycle = await tx.pmocExecution.findFirst({
            where: {
              id: item.id,
              organizationId: actor.organizationId,
              plan: {
                businessUnitId: { in: [...actor.businessUnitIds] },
                deletedAt: null,
                status: 'ACTIVE',
                schedulingPaused: false,
              },
            },
            include: {
              plan: { select: { technicianUserId: true } },
              equipmentExecutions: { select: { operationId: true } },
            },
          });
          if (!cycle) throw new EntityNotFoundException('Ciclo PMOC', item.id);
          if (cycle.authorizedAt) continue;
          if (cycle.status !== 'PENDING' || !cycle.plan.technicianUserId)
            throw new ConflictException(
              'O ciclo precisa estar atribuído e pendente para autorização.',
            );
          const changed = await tx.pmocExecution.updateMany({
            where: {
              id: cycle.id,
              organizationId: actor.organizationId,
              updatedAt: new Date(item.version),
            },
            data: stamp,
          });
          if (!changed.count)
            throw new ConflictException(
              'O ciclo foi alterado. Atualize a fila antes de autorizar.',
            );
          const operationIds = [
            cycle.operationId,
            ...cycle.equipmentExecutions.map(
              (execution) => execution.operationId,
            ),
          ].filter((id): id is string => !!id);
          if (operationIds.length)
            await tx.operation.updateMany({
              where: {
                organizationId: actor.organizationId,
                id: { in: operationIds },
              },
              data: stamp,
            });
        }
        authorized++;
        await tx.auditLog.create({
          data: {
            organizationId: actor.organizationId,
            userId: actor.id,
            action: 'ASSIGNMENT_AUTHORIZED',
            entityType: item.kind === 'RVT' ? 'RvtOccurrence' : 'PmocExecution',
            entityId: item.id,
            after: { authorizedAt: now.toISOString() },
          },
        });
      }
      return { authorized };
    });
  }
}
