import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { PaginationHelper } from '../../database/helpers/database.helpers';
import type { ReportQueryDto } from './dto/report.dto';

const reportInclude = {
  template: {
    select: {
      id: true,
      key: true,
      name: true,
      reportKind: true,
      version: true,
    },
  },
  businessUnit: {
    select: { id: true, legalName: true, tradeName: true },
  },
  customer: {
    select: { id: true, legalName: true, tradeName: true },
  },
  operation: {
    select: { id: true, code: true, title: true, status: true },
  },
  createdBy: {
    select: { id: true, displayName: true, email: true },
  },
  documents: {
    select: {
      id: true,
      version: true,
      format: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      sourceHash: true,
      renderedAt: true,
    },
    orderBy: { version: 'desc' },
  },
  signatures: {
    where: { revokedAt: null },
    select: {
      id: true,
      slotKey: true,
      signerType: true,
      userId: true,
      customerId: true,
      signerName: true,
      signerDocument: true,
      signatureHash: true,
      reportContentHash: true,
      consentText: true,
      signedAt: true,
      revokedAt: true,
    },
    orderBy: { signedAt: 'asc' },
  },
} satisfies Prisma.ReportInclude;

@Injectable()
export class ReportRepository {
  constructor(private readonly rls: RlsTransaction) {}

  list(organizationId: string, query: ReportQueryDto) {
    const pagination = PaginationHelper.normalize(query.page, query.limit);
    const where: Prisma.ReportWhereInput = {
      organizationId,
      deletedAt: null,
      businessUnitId: query.businessUnitId,
      operationId: query.operationId,
      customerId: query.customerId,
      templateId: query.templateId,
      status: query.status,
      createdAt:
        query.createdFrom || query.createdTo
          ? { gte: query.createdFrom, lte: query.createdTo }
          : undefined,
      ...(query.search
        ? {
            OR: [
              { code: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.rls.run(async (transaction) => {
      const data = await transaction.report.findMany({
        where,
        include: reportInclude,
        orderBy: { createdAt: 'desc' },
        ...PaginationHelper.toPrisma(pagination),
      });
      const total = await transaction.report.count({ where });
      return PaginationHelper.result(data, total, pagination);
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.report.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: reportInclude,
      }),
    );
  }

  create(data: Prisma.ReportUncheckedCreateInput) {
    return this.rls.run((transaction) =>
      transaction.report.create({ data, include: reportInclude }),
    );
  }

  update(id: string, data: Prisma.ReportUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.report.update({
        where: { id },
        data,
        include: reportInclude,
      }),
    );
  }

  changeStatus(id: string, fromStatus: string, toStatus: string) {
    return this.rls.run(async (transaction) => {
      const changed = await transaction.report.updateMany({
        where: { id, status: fromStatus, deletedAt: null },
        data: {
          status: toStatus,
          lockedAt:
            toStatus === 'APPROVED'
              ? new Date()
              : toStatus === 'DRAFT'
                ? null
                : undefined,
        },
      });
      if (changed.count !== 1) return null;
      return transaction.report.findUniqueOrThrow({
        where: { id },
        include: reportInclude,
      });
    });
  }

  publish(id: string) {
    return this.rls.run((transaction) =>
      transaction.report.update({
        where: { id },
        data: {
          status: 'PUBLISHED',
          lockedAt: new Date(),
          finalizedAt: new Date(),
        },
        include: reportInclude,
      }),
    );
  }

  createDocument(
    reportId: string,
    organizationId: string,
    sourceHash: string,
    stored: {
      storageBucket: string;
      storageProvider: string;
      storageKey: string;
      sizeBytes: bigint;
      sha256: string;
    },
  ) {
    return this.rls.run(async (transaction) => {
      /** `void` não é desserializável por `$queryRaw` — ver artifact-template.repository. */
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${reportId}))`;
      const latest = await transaction.generatedDocument.aggregate({
        where: { reportId, format: 'PDF' },
        _max: { version: true },
      });
      return transaction.generatedDocument.create({
        data: {
          organizationId,
          reportId,
          version: (latest._max.version ?? 0) + 1,
          format: 'PDF',
          storageBucket: stored.storageBucket,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          mimeType: 'application/pdf',
          sizeBytes: stored.sizeBytes,
          sha256: stored.sha256,
          sourceHash,
        },
      });
    });
  }

  listDocuments(reportId: string) {
    return this.rls.run((transaction) =>
      transaction.generatedDocument.findMany({
        where: { reportId },
        omit: { storageKey: true, storageProvider: true },
        orderBy: { version: 'desc' },
      }),
    );
  }

  findDocument(id: string, reportId: string) {
    return this.rls.run((transaction) =>
      transaction.generatedDocument.findFirst({
        where: { id, reportId },
      }),
    );
  }

  findTemplate(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.reportTemplate.findFirst({
        where: {
          id,
          organizationId,
          deletedAt: null,
          isActive: true,
        },
      }),
    );
  }

  findBusinessUnit(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.businessUnit.findFirst({
        where: { id, organizationId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      }),
    );
  }

  findCustomer(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.customer.findFirst({
        where: { id, organizationId, deletedAt: null, status: 'ACTIVE' },
        select: { id: true },
      }),
    );
  }

  findOperation(id: string, organizationId: string, businessUnitId: string) {
    return this.rls.run((transaction) =>
      transaction.operation.findFirst({
        where: {
          id,
          organizationId,
          businessUnitId,
          deletedAt: null,
        },
        select: { id: true, customerId: true },
      }),
    );
  }

  softDelete(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.report.update({
          where: { id },
          data: { deletedAt: new Date(), status: 'ARCHIVED' },
        }),
      )
      .then(() => undefined);
  }
}
