import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { PaginationHelper } from '../../database/helpers/database.helpers';
import type {
  ChecklistExecutionQueryDto,
  ChecklistTemplateQueryDto,
} from './checklist.dto';

@Injectable()
export class ChecklistRepository {
  constructor(private readonly rls: RlsTransaction) {}

  listTemplates(organizationId: string, query: ChecklistTemplateQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.ChecklistTemplateWhereInput = {
      organizationId,
      deletedAt: null,
      isActive: query.isActive,
      ...(query.operationKind ? { operationKind: query.operationKind } : {}),
      ...(query.search
        ? {
            OR: [
              { key: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.rls.run(async (tx) => {
      const data = await tx.checklistTemplate.findMany({
        where,
        orderBy: [{ key: 'asc' }, { version: 'desc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.checklistTemplate.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  findTemplate(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.checklistTemplate.findFirst({
        where: { id, organizationId, deletedAt: null },
      }),
    );
  }

  createTemplate(
    organizationId: string,
    data: Omit<Prisma.ChecklistTemplateUncheckedCreateInput, 'organizationId'>,
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${data.key}`}))`;
      const latest = await tx.checklistTemplate.aggregate({
        where: { organizationId, key: data.key },
        _max: { version: true },
      });
      return tx.checklistTemplate.create({
        data: {
          ...data,
          organizationId,
          version: (latest._max.version ?? 0) + 1,
        },
      });
    });
  }

  updateTemplate(id: string, data: Prisma.ChecklistTemplateUpdateInput) {
    return this.rls.run((tx) =>
      tx.checklistTemplate.update({ where: { id }, data }),
    );
  }

  deleteTemplate(id: string) {
    return this.rls.run((tx) =>
      tx.checklistTemplate.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      }),
    );
  }

  listExecutions(organizationId: string, query: ChecklistExecutionQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where = {
      organizationId,
      operationId: query.operationId,
      businessUnitId: query.businessUnitId,
      status: query.status,
    };
    return this.rls.run(async (tx) => {
      const data = await tx.checklistExecution.findMany({
        where,
        include: {
          template: { select: { id: true, key: true, name: true } },
          createdBy: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.checklistExecution.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  findExecution(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.checklistExecution.findFirst({
        where: { id, organizationId },
        include: {
          template: { select: { id: true, key: true, name: true } },
          createdBy: { select: { id: true, displayName: true } },
          operation: { select: { id: true, code: true, title: true } },
        },
      }),
    );
  }

  createExecution(
    data: Prisma.ChecklistExecutionUncheckedCreateInput,
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      const execution = await tx.checklistExecution.create({ data });
      if (data.operationId) {
        await tx.operationHistory.create({
          data: {
            operationId: data.operationId,
            userId: actorId,
            action: 'CHECKLIST_STARTED',
            details: { checklistExecutionId: execution.id },
          },
        });
      }
      return execution;
    });
  }

  updateExecution(
    id: string,
    data: Prisma.ChecklistExecutionUpdateInput,
    actorId: string,
    action: string,
    operationId?: string | null,
  ) {
    return this.rls.run(async (tx) => {
      const execution = await tx.checklistExecution.update({
        where: { id },
        data,
      });
      if (operationId) {
        await tx.operationHistory.create({
          data: {
            operationId,
            userId: actorId,
            action,
            details: {
              checklistExecutionId: id,
              progress: execution.progress,
            },
          },
        });
      }
      return execution;
    });
  }
}
