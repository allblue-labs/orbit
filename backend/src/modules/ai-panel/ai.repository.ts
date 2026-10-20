import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { PaginationHelper } from '../../database/helpers/database.helpers';
import type { AiAgentQueryDto, AiExecutionQueryDto } from './ai.dto';

const agentInclude = {
  integration: {
    select: {
      id: true,
      provider: true,
      displayName: true,
      status: true,
      configuration: true,
    },
  },
  _count: { select: { executions: true } },
} satisfies Prisma.AiAgentInclude;

const executionInclude = {
  agent: { select: { id: true, key: true, name: true, version: true } },
  user: { select: { id: true, displayName: true } },
  customer: { select: { id: true, legalName: true, tradeName: true } },
  operation: { select: { id: true, code: true, title: true } },
  report: { select: { id: true, code: true, title: true } },
} satisfies Prisma.AiExecutionInclude;

@Injectable()
export class AiRepository {
  constructor(private readonly rls: RlsTransaction) {}

  listAgents(organizationId: string, query: AiAgentQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.AiAgentWhereInput = {
      organizationId,
      deletedAt: null,
      status: query.status,
      ...(query.search
        ? {
            OR: [
              { key: { contains: query.search, mode: 'insensitive' } },
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.rls.run(async (tx) => {
      const data = await tx.aiAgent.findMany({
        where,
        include: agentInclude,
        orderBy: [{ key: 'asc' }, { version: 'desc' }],
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.aiAgent.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  findAgent(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.aiAgent.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: agentInclude,
      }),
    );
  }

  findAgentInternal(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.aiAgent.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: { integration: true },
      }),
    );
  }

  createAgent(
    organizationId: string,
    data: Omit<Prisma.AiAgentUncheckedCreateInput, 'organizationId'>,
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${data.key}`}))`;
      const latest = await tx.aiAgent.aggregate({
        where: { organizationId, key: data.key },
        _max: { version: true },
      });
      return tx.aiAgent.create({
        data: {
          ...data,
          organizationId,
          version: (latest._max.version ?? 0) + 1,
        },
        include: agentInclude,
      });
    });
  }

  updateAgent(id: string, data: Prisma.AiAgentUpdateInput) {
    return this.rls.run((tx) =>
      tx.aiAgent.update({ where: { id }, data, include: agentInclude }),
    );
  }

  deleteAgent(id: string) {
    return this.rls.run((tx) =>
      tx.aiAgent.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'INACTIVE' },
      }),
    );
  }

  findIntegration(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.integration.findFirst({
        where: { id, organizationId, status: 'ACTIVE', deletedAt: null },
        select: { id: true, provider: true, category: true },
      }),
    );
  }

  listExecutions(organizationId: string, query: AiExecutionQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.AiExecutionWhereInput = {
      organizationId,
      agentId: query.agentId,
      customerId: query.customerId,
      operationId: query.operationId,
      reportId: query.reportId,
      status: query.status,
    };
    return this.rls.run(async (tx) => {
      const data = await tx.aiExecution.findMany({
        where,
        include: executionInclude,
        orderBy: { createdAt: 'desc' },
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await tx.aiExecution.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  findExecution(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.aiExecution.findFirst({
        where: { id, organizationId },
        include: executionInclude,
      }),
    );
  }

  findByIdempotency(organizationId: string, userId: string, key: string) {
    return this.rls.run((tx) =>
      tx.aiExecution.findFirst({
        where: { organizationId, userId, idempotencyKey: key },
        include: executionInclude,
      }),
    );
  }

  createExecution(data: Prisma.AiExecutionUncheckedCreateInput) {
    return this.rls.run((tx) =>
      tx.aiExecution.create({ data, include: executionInclude }),
    );
  }

  startExecution(id: string) {
    return this.rls.run(async (tx) => {
      const changed = await tx.aiExecution.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'RUNNING', startedAt: new Date() },
      });
      return changed.count === 1;
    });
  }

  finishExecution(id: string, data: Prisma.AiExecutionUpdateInput) {
    return this.rls.run((tx) =>
      tx.aiExecution.update({ where: { id }, data, include: executionInclude }),
    );
  }

  cancelExecution(id: string) {
    return this.rls.run((tx) =>
      tx.aiExecution.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CANCELLED', completedAt: new Date() },
      }),
    );
  }

  context(
    organizationId: string,
    references: {
      customerId?: string;
      operationId?: string;
      reportId?: string;
    },
  ) {
    return this.rls.run(async (tx) => {
      const customer = references.customerId
        ? await tx.customer.findFirst({
            where: {
              id: references.customerId,
              organizationId,
              deletedAt: null,
            },
            select: {
              id: true,
              type: true,
              legalName: true,
              tradeName: true,
              status: true,
              notes: true,
              address: true,
            },
          })
        : null;
      const operation = references.operationId
        ? await tx.operation.findFirst({
            where: {
              id: references.operationId,
              organizationId,
              deletedAt: null,
            },
            select: {
              id: true,
              businessUnitId: true,
              customerId: true,
              code: true,
              kind: true,
              title: true,
              description: true,
              status: true,
              priority: true,
              scheduledStart: true,
              scheduledEnd: true,
              data: true,
            },
          })
        : null;
      const report = references.reportId
        ? await tx.report.findFirst({
            where: {
              id: references.reportId,
              organizationId,
              deletedAt: null,
            },
            select: {
              id: true,
              businessUnitId: true,
              customerId: true,
              operationId: true,
              code: true,
              title: true,
              status: true,
              contentHash: true,
              data: true,
              finalizedAt: true,
            },
          })
        : null;
      return { customer, operation, report };
    });
  }
}
