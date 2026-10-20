import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import type {
  CustomerPortalAssetListQueryDto,
  CustomerPortalDocumentListQueryDto,
  CustomerPortalOperationListQueryDto,
  CustomerPortalPmocListQueryDto,
  CustomerPortalRvtListQueryDto,
} from './customer-portal-read.dto';

export interface CustomerPortalReadScope {
  organizationId: string;
  customerId: string;
}

export interface CustomerPortalRepositoryPage<T> {
  data: readonly T[];
  total: number;
  page: number;
  limit: number;
}

const FINAL_EXECUTION_STATUSES = ['APPROVED', 'COMPLETED', 'ARCHIVED'];

const availableManifestWhere = {
  status: 'ISSUED',
  isActive: true,
  revokedAt: null,
  deletedAt: null,
  file: { is: { status: 'AVAILABLE', deletedAt: null } },
} satisfies Prisma.ArtifactManifestWhereInput;

const operationSelect = {
  id: true,
  organizationId: true,
  customerId: true,
  code: true,
  kind: true,
  title: true,
  description: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  startedAt: true,
  completedAt: true,
  location: true,
  businessUnit: {
    select: { id: true, legalName: true, tradeName: true, timezone: true },
  },
  /** Os equipamentos do atendimento; o portal lista todos, não o primeiro. */
  assets: {
    orderBy: { createdAt: 'asc' as const },
    select: { asset: { select: { id: true, name: true } } },
  },
  responsibleFieldTechnician: { select: { displayName: true } },
  _count: {
    select: {
      artifactExecutions: {
        where: {
          deletedAt: null,
          status: { in: FINAL_EXECUTION_STATUSES },
          manifests: { some: availableManifestWhere },
        },
      },
    },
  },
} satisfies Prisma.OperationSelect;

export type CustomerPortalOperationRecord = Prisma.OperationGetPayload<{
  select: typeof operationSelect;
}>;

const assetSelect = {
  id: true,
  organizationId: true,
  customerId: true,
  category: true,
  name: true,
  manufacturer: true,
  model: true,
  serialNumber: true,
  identifier: true,
  installationAt: true,
  warrantyUntil: true,
  location: true,
  status: true,
  businessUnit: {
    select: { id: true, legalName: true, tradeName: true, timezone: true },
  },
  _count: {
    select: {
      /** Quantos atendimentos tocaram este equipamento. */
      operationLinks: { where: { operation: { deletedAt: null } } },
      pmocCoverages: { where: { deletedAt: null } },
      artifactExecutions: {
        where: {
          deletedAt: null,
          status: { in: FINAL_EXECUTION_STATUSES },
          manifests: { some: availableManifestWhere },
        },
      },
    },
  },
} satisfies Prisma.AssetSelect;

export type CustomerPortalAssetRecord = Prisma.AssetGetPayload<{
  select: typeof assetSelect;
}> & { rvtConfigurations: number };

const pmocSelect = {
  id: true,
  organizationId: true,
  customerId: true,
  code: true,
  name: true,
  status: true,
  startsOn: true,
  endsOn: true,
  frequencyAmount: true,
  frequencyUnit: true,
  dueSoonDays: true,
  nextDueOn: true,
  businessUnit: {
    select: { id: true, legalName: true, tradeName: true, timezone: true },
  },
  _count: { select: { coverages: { where: { deletedAt: null } } } },
} satisfies Prisma.PmocPlanSelect;

export type CustomerPortalPmocRecord = Prisma.PmocPlanGetPayload<{
  select: typeof pmocSelect;
}>;

const rvtSelect = {
  id: true,
  organizationId: true,
  customerId: true,
  code: true,
  name: true,
  /** O tipo de manutenção contratado — era `visitType`, de dois valores. */
  maintenanceType: { select: { id: true, key: true, label: true } },
  scheduleMode: true,
  coverageStart: true,
  coverageEnd: true,
  timezone: true,
  status: true,
  _count: {
    select: {
      occurrences: true,
    },
  },
  occurrences: {
    where: { status: { in: ['SCHEDULED', 'IN_PROGRESS'] } },
    orderBy: [{ scheduledFor: 'asc' as const }, { id: 'asc' as const }],
    take: 1,
    select: { scheduledFor: true },
  },
} satisfies Prisma.RvtConfigurationSelect;

export type CustomerPortalRvtRecord = Prisma.RvtConfigurationGetPayload<{
  select: typeof rvtSelect;
}> & { completedVisits: number };

const documentSelect = {
  id: true,
  organizationId: true,
  revision: true,
  format: true,
  issuedAt: true,
  execution: {
    select: {
      customerId: true,
      title: true,
      status: true,
      snapshot: { select: { artifactType: true, templateName: true } },
    },
  },
  file: {
    select: {
      bucket: true,
      objectKey: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      status: true,
    },
  },
} satisfies Prisma.ArtifactManifestSelect;

export type CustomerPortalDocumentRecord = Prisma.ArtifactManifestGetPayload<{
  select: typeof documentSelect;
}>;

@Injectable()
export class CustomerPortalReadRepository {
  constructor(private readonly rls: RlsTransaction) {}

  dashboard(scope: CustomerPortalReadScope) {
    return this.rls.run(async (tx) => {
      const recentSince = new Date(Date.now() - 90 * 24 * 60 * 60 * 1_000);
      const recentOperations = await tx.operation.count({
        where: { ...scope, deletedAt: null, createdAt: { gte: recentSince } },
      });
      const assets = await tx.asset.count({
        where: { ...scope, deletedAt: null },
      });
      const activePmocPlans = await tx.pmocPlan.count({
        where: { ...scope, deletedAt: null, status: 'ACTIVE' },
      });
      const upcomingVisits = await tx.rvtOccurrence.count({
        where: {
          organizationId: scope.organizationId,
          status: 'SCHEDULED',
          scheduledFor: { gte: new Date() },
          configuration: {
            customerId: scope.customerId,
            deletedAt: null,
          },
        },
      });
      const availableDocuments = await tx.artifactManifest.count({
        where: this.documentWhere(scope),
      });
      return {
        recentOperations,
        assets,
        activePmocPlans,
        upcomingVisits,
        availableDocuments,
      };
    });
  }

  listOperations(
    scope: CustomerPortalReadScope,
    query: CustomerPortalOperationListQueryDto,
    status?: string,
  ): Promise<CustomerPortalRepositoryPage<CustomerPortalOperationRecord>> {
    return this.rls.run(async (tx) => {
      const where: Prisma.OperationWhereInput = {
        ...scope,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { title: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const total = await tx.operation.count({ where });
      const data = await tx.operation.findMany({
        where,
        select: operationSelect,
        orderBy: this.operationOrder(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return { data, total, page: query.page, limit: query.limit };
    });
  }

  findOperation(scope: CustomerPortalReadScope, id: string) {
    return this.rls.run((tx) =>
      tx.operation.findFirst({
        where: { id, ...scope, deletedAt: null },
        select: {
          ...operationSelect,
          history: {
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 30,
            select: {
              id: true,
              action: true,
              fromStatus: true,
              toStatus: true,
              createdAt: true,
            },
          },
        },
      }),
    );
  }

  listAssets(
    scope: CustomerPortalReadScope,
    query: CustomerPortalAssetListQueryDto,
    status?: string,
  ): Promise<CustomerPortalRepositoryPage<CustomerPortalAssetRecord>> {
    return this.rls.run(async (tx) => {
      const where: Prisma.AssetWhereInput = {
        ...scope,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { identifier: { contains: query.search, mode: 'insensitive' } },
                {
                  serialNumber: { contains: query.search, mode: 'insensitive' },
                },
              ],
            }
          : {}),
      };
      const total = await tx.asset.count({ where });
      const rows = await tx.asset.findMany({
        where,
        select: assetSelect,
        orderBy: this.assetOrder(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      const rvtCounts = await this.rvtAssetCounts(
        tx,
        scope,
        rows.map((row) => row.id),
      );
      const data = rows.map((row) => ({
        ...row,
        rvtConfigurations: rvtCounts.get(row.id) ?? 0,
      }));
      return { data, total, page: query.page, limit: query.limit };
    });
  }

  findAsset(scope: CustomerPortalReadScope, id: string) {
    return this.rls.run(async (tx) => {
      const row = await tx.asset.findFirst({
        where: { id, ...scope, deletedAt: null },
        select: assetSelect,
      });
      if (!row) return null;
      const counts = await this.rvtAssetCounts(tx, scope, [row.id]);
      return { ...row, rvtConfigurations: counts.get(row.id) ?? 0 };
    });
  }

  listPmoc(
    scope: CustomerPortalReadScope,
    query: CustomerPortalPmocListQueryDto,
    status?: string,
  ): Promise<CustomerPortalRepositoryPage<CustomerPortalPmocRecord>> {
    return this.rls.run(async (tx) => {
      const where: Prisma.PmocPlanWhereInput = {
        ...scope,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const total = await tx.pmocPlan.count({ where });
      const data = await tx.pmocPlan.findMany({
        where,
        select: pmocSelect,
        orderBy: this.pmocOrder(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return { data, total, page: query.page, limit: query.limit };
    });
  }

  findPmoc(scope: CustomerPortalReadScope, id: string) {
    return this.rls.run((tx) =>
      tx.pmocPlan.findFirst({
        where: { id, ...scope, deletedAt: null },
        select: {
          ...pmocSelect,
          executions: {
            orderBy: [{ dueOn: 'desc' }, { id: 'desc' }],
            take: 50,
            select: {
              id: true,
              sequenceNumber: true,
              dueOn: true,
              status: true,
              performedAt: true,
              artifactExecution: {
                select: {
                  _count: {
                    select: { manifests: { where: availableManifestWhere } },
                  },
                },
              },
            },
          },
        },
      }),
    );
  }

  listRvt(
    scope: CustomerPortalReadScope,
    query: CustomerPortalRvtListQueryDto,
    status?: string,
  ): Promise<CustomerPortalRepositoryPage<CustomerPortalRvtRecord>> {
    return this.rls.run(async (tx) => {
      const where: Prisma.RvtConfigurationWhereInput = {
        ...scope,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(query.search
          ? {
              OR: [
                { code: { contains: query.search, mode: 'insensitive' } },
                { name: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const total = await tx.rvtConfiguration.count({ where });
      const rows = await tx.rvtConfiguration.findMany({
        where,
        select: rvtSelect,
        orderBy: this.rvtOrder(query),
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      const completed = await tx.rvtOccurrence.groupBy({
        by: ['configurationId'],
        where: {
          organizationId: scope.organizationId,
          configurationId: { in: rows.map((row) => row.id) },
          status: 'COMPLETED',
        },
        _count: { _all: true },
      });
      const counts = new Map(
        completed.map((row) => [row.configurationId, row._count._all]),
      );
      const data = rows.map((row) => ({
        ...row,
        completedVisits: counts.get(row.id) ?? 0,
      }));
      return { data, total, page: query.page, limit: query.limit };
    });
  }

  findRvt(scope: CustomerPortalReadScope, id: string) {
    return this.rls.run(async (tx) => {
      const row = await tx.rvtConfiguration.findFirst({
        where: { id, ...scope, deletedAt: null },
        select: {
          ...rvtSelect,
          occurrences: {
            orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
            take: 50,
            select: {
              id: true,
              sequenceNumber: true,
              scheduledFor: true,
              localScheduledDate: true,
              status: true,
              execution: {
                select: {
                  artifactExecutionId: true,
                  performedAt: true,
                },
              },
            },
          },
        },
      });
      if (!row) return null;
      const artifactExecutionIds = row.occurrences.flatMap((occurrence) =>
        occurrence.execution?.artifactExecutionId
          ? [occurrence.execution.artifactExecutionId]
          : [],
      );
      const manifests = artifactExecutionIds.length
        ? await tx.artifactManifest.findMany({
            where: {
              ...availableManifestWhere,
              executionId: { in: artifactExecutionIds },
              execution: {
                customerId: scope.customerId,
                organizationId: scope.organizationId,
                deletedAt: null,
                status: { in: FINAL_EXECUTION_STATUSES },
              },
            },
            select: { executionId: true },
          })
        : [];
      return {
        ...row,
        completedVisits: row.occurrences.filter(
          (occurrence) => occurrence.status === 'COMPLETED',
        ).length,
        documentExecutionIds: new Set(
          manifests.map((manifest) => manifest.executionId),
        ),
      };
    });
  }

  listDocuments(
    scope: CustomerPortalReadScope,
    query: CustomerPortalDocumentListQueryDto,
  ): Promise<CustomerPortalRepositoryPage<CustomerPortalDocumentRecord>> {
    return this.rls.run(async (tx) => {
      const where = this.documentWhere(scope, query.search);
      const total = await tx.artifactManifest.count({ where });
      const data = await tx.artifactManifest.findMany({
        where,
        select: documentSelect,
        orderBy:
          query.sortBy === 'fileName'
            ? [{ file: { fileName: query.order } }, { id: 'asc' as const }]
            : [{ issuedAt: query.order }, { id: 'asc' as const }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return { data, total, page: query.page, limit: query.limit };
    });
  }

  findDocument(scope: CustomerPortalReadScope, id: string) {
    return this.rls.run((tx) =>
      tx.artifactManifest.findFirst({
        where: { id, ...this.documentWhere(scope) },
        select: documentSelect,
      }),
    );
  }

  private documentWhere(
    scope: CustomerPortalReadScope,
    search?: string,
  ): Prisma.ArtifactManifestWhereInput {
    return {
      organizationId: scope.organizationId,
      ...availableManifestWhere,
      issuedAt: { not: null },
      execution: {
        organizationId: scope.organizationId,
        customerId: scope.customerId,
        deletedAt: null,
        status: { in: FINAL_EXECUTION_STATUSES },
      },
      ...(search
        ? {
            OR: [
              {
                file: {
                  is: { fileName: { contains: search, mode: 'insensitive' } },
                },
              },
              {
                execution: { title: { contains: search, mode: 'insensitive' } },
              },
            ],
          }
        : {}),
    };
  }

  private operationOrder(
    query: CustomerPortalOperationListQueryDto,
  ): Prisma.OperationOrderByWithRelationInput[] {
    const first =
      query.sortBy === 'code'
        ? { code: query.order }
        : query.sortBy === 'createdAt'
          ? { createdAt: query.order }
          : { scheduledStart: query.order };
    return [first, { id: 'asc' }];
  }

  private assetOrder(
    query: CustomerPortalAssetListQueryDto,
  ): Prisma.AssetOrderByWithRelationInput[] {
    return [
      query.sortBy === 'createdAt'
        ? { createdAt: query.order }
        : { name: query.order },
      { id: 'asc' },
    ];
  }

  private pmocOrder(
    query: CustomerPortalPmocListQueryDto,
  ): Prisma.PmocPlanOrderByWithRelationInput[] {
    const first =
      query.sortBy === 'name'
        ? { name: query.order }
        : query.sortBy === 'createdAt'
          ? { createdAt: query.order }
          : { nextDueOn: query.order };
    return [first, { id: 'asc' }];
  }

  private rvtOrder(
    query: CustomerPortalRvtListQueryDto,
  ): Prisma.RvtConfigurationOrderByWithRelationInput[] {
    const first =
      query.sortBy === 'name'
        ? { name: query.order }
        : query.sortBy === 'createdAt'
          ? { createdAt: query.order }
          : { coverageStart: query.order };
    return [first, { id: 'asc' }];
  }

  private async rvtAssetCounts(
    tx: Prisma.TransactionClient,
    scope: CustomerPortalReadScope,
    assetIds: readonly string[],
  ): Promise<Map<string, number>> {
    if (assetIds.length === 0) return new Map();
    const rows = await tx.rvtConfigurationEquipment.groupBy({
      by: ['assetId'],
      where: {
        organizationId: scope.organizationId,
        assetId: { in: [...assetIds] },
        removedAt: null,
        configuration: {
          customerId: scope.customerId,
          deletedAt: null,
        },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.assetId, row._count._all]));
  }
}
