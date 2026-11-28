import { Injectable } from '@nestjs/common';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import { JOB_QUEUES, scopeFor } from '../jobs/background-job.types';
import { assignmentAuthorizationRequired } from '../operations/recurring-authorization';

const assignmentFields = {
  id: true,
  organizationId: true,
  businessUnitId: true,
  updatedAt: true,
  authorizedAt: true,
  status: true,
  deletedAt: true,
  responsibleFieldTechnicianId: true,
} as const;

/** Assignment and notification intent commit together. The recipient worker
 * materializes its private inbox, then rechecks eligibility before delivery. */
@Injectable()
export class FieldAssignmentOutbox {
  constructor(private readonly jobs: BackgroundJobQueue) {}

  private async enqueue(
    tx: PrismaTransactionClient,
    row: {
      id: string;
      organizationId: string;
      businessUnitId: string;
      updatedAt: Date;
    },
    workItemId: string,
    recipients: readonly (string | null)[],
  ) {
    for (const recipient of new Set(
      recipients.filter((id): id is string => !!id),
    )) {
      const factId = `${workItemId}:${row.updatedAt.toISOString()}`;
      await this.jobs.enqueue(
        {
          queue: JOB_QUEUES.mobileNotification,
          jobKey: `WORK_ASSIGNED:${factId}:${recipient}`,
          organizationId: row.organizationId,
          actorUserId: recipient,
          correlationId: generateUuidV7(),
          payload: {
            type: 'WORK_ASSIGNED',
            factId,
            resourceId: row.id,
            workItemId,
          },
          ...scopeFor(row.businessUnitId, [row.businessUnitId]),
        },
        tx,
      );
    }
  }

  async operation(tx: PrismaTransactionClient, id: string) {
    const row = await tx.operation.findUnique({
      where: { id },
      select: {
        ...assignmentFields,
        auxiliaryTechnicians: {
          where: { removedAt: null },
          select: { userId: true },
        },
      },
    });
    if (
      !row ||
      row.deletedAt ||
      ['CANCELLED', 'COMPLETED'].includes(row.status)
    )
      return;
    if (
      !row.authorizedAt &&
      (await assignmentAuthorizationRequired(tx, row.organizationId))
    )
      return;
    await this.enqueue(tx, row, `SERVICE_OPERATION:${id}`, [
      row.responsibleFieldTechnicianId,
      ...row.auxiliaryTechnicians.map((x) => x.userId),
    ]);
  }

  async rvt(tx: PrismaTransactionClient, id: string) {
    const row = await tx.rvtOccurrence.findUnique({
      where: { id },
      select: assignmentFields,
    });
    if (
      !row ||
      row.deletedAt ||
      !['SCHEDULED', 'IN_PROGRESS'].includes(row.status)
    )
      return;
    if (
      !row.authorizedAt &&
      (await assignmentAuthorizationRequired(tx, row.organizationId))
    )
      return;
    await this.enqueue(tx, row, `RVT:${id}`, [
      row.responsibleFieldTechnicianId,
    ]);
  }

  async pmoc(tx: PrismaTransactionClient, id: string) {
    const row = await tx.pmocExecution.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        updatedAt: true,
        authorizedAt: true,
        status: true,
        plan: {
          select: {
            businessUnitId: true,
            deletedAt: true,
            status: true,
            schedulingPaused: true,
            technicianUserId: true,
            coverages: {
              where: { deletedAt: null },
              select: { assetId: true },
            },
          },
        },
        equipmentSchedules: {
          select: {
            coverage: { select: { assetId: true } },
            responsibleFieldTechnicianId: true,
            auxiliaryTechnicianIds: true,
            cancelledAt: true,
          },
        },
        equipmentExecutions: {
          select: {
            assetId: true,
            status: true,
            responsibleFieldTechnicianId: true,
            operation: {
              select: {
                auxiliaryTechnicians: {
                  where: { removedAt: null },
                  select: { userId: true },
                },
              },
            },
          },
        },
      },
    });
    if (
      !row ||
      ['CANCELLED', 'COMPLETED'].includes(row.status) ||
      row.plan.deletedAt ||
      row.plan.status !== 'ACTIVE' ||
      row.plan.schedulingPaused
    )
      return;
    if (
      !row.authorizedAt &&
      (await assignmentAuthorizationRequired(tx, row.organizationId))
    )
      return;
    const schedules = new Map(
      row.equipmentSchedules.map((x) => [x.coverage.assetId, x]),
    );
    const executions = new Map(
      row.equipmentExecutions.map((x) => [x.assetId, x]),
    );
    for (const coverage of row.plan.coverages) {
      const schedule = schedules.get(coverage.assetId);
      const execution = executions.get(coverage.assetId);
      if (
        schedule?.cancelledAt ||
        (execution && ['CANCELLED', 'COMPLETED'].includes(execution.status))
      )
        continue;
      const recipients = execution
        ? [
            execution.responsibleFieldTechnicianId,
            ...(execution.operation?.auxiliaryTechnicians ?? []).map(
              (x) => x.userId,
            ),
          ]
        : schedule
          ? [
              schedule.responsibleFieldTechnicianId,
              ...schedule.auxiliaryTechnicianIds,
            ]
          : [row.plan.technicianUserId];
      await this.enqueue(
        tx,
        { ...row, businessUnitId: row.plan.businessUnitId },
        `PMOC:${id}:${coverage.assetId}`,
        recipients,
      );
    }
  }
}
