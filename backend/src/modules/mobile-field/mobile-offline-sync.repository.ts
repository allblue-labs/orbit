import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConflictException } from '../../exceptions';
import { RlsTransaction } from '../../database';
import { mobileSyncRetention, retentionDate } from './mobile-sync-retention';

@Injectable()
export class MobileOfflineSyncRepository {
  constructor(private readonly rls: RlsTransaction) {}

  operationScopes(
    organizationId: string,
    actorId: string,
    businessUnitIds: readonly string[],
    operationIds: readonly string[],
  ) {
    return this.rls.run((tx) =>
      tx.operation.findMany({
        where: {
          organizationId,
          id: { in: [...new Set(operationIds)] },
          businessUnitId: { in: [...businessUnitIds] },
          deletedAt: null,
          OR: [
            { responsibleFieldTechnicianId: actorId },
            {
              auxiliaryTechnicians: {
                some: { userId: actorId, removedAt: null },
              },
            },
          ],
        },
        select: { id: true, businessUnitId: true },
      }),
    );
  }

  currentPermissions(
    organizationId: string,
    actorId: string,
    businessUnitIds: readonly string[],
  ) {
    return this.rls.run(async (tx) => {
      const organizationMembership = await tx.organizationMembership.findFirst({
        where: { organizationId, userId: actorId, status: 'ACTIVE' },
        select: { role: { select: { permissions: true } } },
      });
      const unitMemberships = await tx.businessUnitMembership.findMany({
        where: {
          organizationId,
          userId: actorId,
          businessUnitId: { in: [...businessUnitIds] },
          status: 'ACTIVE',
          deletedAt: null,
        },
        select: { role: { select: { permissions: true } } },
      });
      return [
        ...(organizationMembership?.role.permissions ?? []),
        ...unitMemberships.flatMap((membership) => membership.role.permissions),
      ];
    });
  }

  pmocPackage(organizationId: string, cycleId: string, assetId: string | null) {
    return this.rls.run((tx) =>
      tx.pmocExecution.findFirst({
        where: { id: cycleId, organizationId },
        select: {
          id: true,
          status: true,
          dueOn: true,
          updatedAt: true,
          plan: {
            select: {
              procedure: true,
              technicalResponsibleUserId: true,
            },
          },
          equipmentExecutions: {
            where: assetId ? { assetId } : undefined,
            take: 1,
            select: {
              id: true,
              status: true,
              procedureSnapshot: true,
              responsibleFieldTechnician: {
                select: { id: true, displayName: true },
              },
            },
          },
        },
      }),
    );
  }

  rvtPackage(organizationId: string, occurrenceId: string) {
    return this.rls.run((tx) =>
      tx.rvtOccurrence.findFirst({
        where: { id: occurrenceId, organizationId },
        select: {
          id: true,
          status: true,
          scheduledFor: true,
          updatedAt: true,
          configuration: {
            select: {
              procedure: true,
              requiresTechnicalResponsible: true,
              technicalResponsibleUserId: true,
            },
          },
          execution: {
            select: {
              id: true,
              status: true,
              procedureSnapshot: true,
              responsibleFieldTechnicianId: true,
            },
          },
        },
      }),
    );
  }

  findReceipt(
    organizationId: string,
    actorId: string,
    commandId: string,
    idempotencyKey: string,
  ) {
    return this.rls.run((tx) =>
      tx.mobileOfflineCommandReceipt.findFirst({
        where: {
          organizationId,
          actorId,
          OR: [{ commandId }, { idempotencyKey }],
        },
      }),
    );
  }

  persistApplied(input: {
    organizationId: string;
    businessUnitId: string;
    actorId: string;
    commandId: string;
    idempotencyKey: string;
    commandType: string;
    aggregateType: string;
    aggregateId: string;
    deviceInstanceId?: string;
    payloadHash: string;
    result: Record<string, unknown>;
    serverVersion?: string;
    occurredAt: Date;
    resourceId: string;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`offline-receipt:${input.organizationId}:${input.actorId}:${input.idempotencyKey}`}))`;
      const existing = await tx.mobileOfflineCommandReceipt.findFirst({
        where: {
          organizationId: input.organizationId,
          actorId: input.actorId,
          OR: [
            { commandId: input.commandId },
            { idempotencyKey: input.idempotencyKey },
          ],
        },
      });
      if (existing) {
        if (
          existing.payloadHash !== input.payloadHash ||
          existing.commandType !== input.commandType ||
          existing.aggregateId !== input.aggregateId
        )
          throw new ConflictException(
            'Idempotency key reused with a different offline command',
          );
        return { receipt: existing, alreadyApplied: true };
      }
      const retention = mobileSyncRetention();
      const expiresAt = retentionDate(retention.receiptDays);
      const journalExpiresAt = retentionDate(retention.journalDays);
      const receipt = await tx.mobileOfflineCommandReceipt.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          actorId: input.actorId,
          commandId: input.commandId,
          idempotencyKey: input.idempotencyKey,
          commandType: input.commandType,
          aggregateType: input.aggregateType,
          aggregateId: input.aggregateId,
          deviceInstanceId: input.deviceInstanceId,
          payloadHash: input.payloadHash,
          resultStatus: 'APPLIED',
          result: input.result as Prisma.InputJsonValue,
          serverVersion: input.serverVersion,
          occurredAt: input.occurredAt,
          expiresAt,
        },
      });
      await tx.mobileSyncChange.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          resourceType: 'WORK_ITEM',
          resourceId: input.resourceId,
          changeType: 'UPSERTED',
          resourceVersion: input.serverVersion,
          actorId: input.actorId,
          expiresAt: journalExpiresAt,
        },
      });
      return { receipt, alreadyApplied: false };
    });
  }

  journal(
    organizationId: string,
    businessUnitIds: readonly string[],
    after: bigint,
    limit: number,
  ) {
    return this.rls.run((tx) =>
      tx.mobileSyncChange.findMany({
        where: {
          organizationId,
          businessUnitId: { in: [...businessUnitIds] },
          sequence: { gt: after },
        },
        orderBy: { sequence: 'asc' },
        take: limit + 1,
      }),
    );
  }

  journalBounds(organizationId: string, businessUnitIds: readonly string[]) {
    return this.rls.run(async (tx) => {
      const where = {
        organizationId,
        businessUnitId: { in: [...businessUnitIds] },
      };
      const oldest = await tx.mobileSyncChange.findFirst({
        where,
        orderBy: { sequence: 'asc' },
        select: { sequence: true, occurredAt: true },
      });
      const latest = await tx.mobileSyncChange.findFirst({
        where,
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });
      return { oldest, latest };
    });
  }

  cleanupExpired(now = new Date()) {
    return this.rls.run(async (tx) => {
      const limit = mobileSyncRetention().cleanupBatchSize;
      const receipts = await tx.$executeRaw`
        DELETE FROM mobile_offline_command_receipts
         WHERE id IN (
           SELECT id FROM mobile_offline_command_receipts
            WHERE expires_at < ${now}
            ORDER BY expires_at ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
         )`;
      const journal = await tx.$executeRaw`
        DELETE FROM mobile_sync_changes
         WHERE sequence IN (
           SELECT sequence FROM mobile_sync_changes
            WHERE expires_at < ${now}
            ORDER BY expires_at ASC
            LIMIT ${limit}
            FOR UPDATE SKIP LOCKED
         )`;
      return { receiptsDeleted: receipts, journalDeleted: journal };
    });
  }
}
