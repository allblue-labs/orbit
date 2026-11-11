import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { EntityNotFoundException } from '../../exceptions';
import {
  addCivilDays,
  civilDateKey,
  instantFromCivilDate,
} from '../scheduling/scheduling-time';
import type { AnalyticsDomain } from './analytics.read-models';
import type {
  AnalyticsCommitment,
  AnalyticsRange,
  AnalyticsSnapshot,
} from './analytics.types';

const operationSelect = {
  id: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  responsibleFieldTechnicianId: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
} satisfies Prisma.OperationSelect;

/** Read-only facts, scoped by organization, selected unit and database RLS. */
@Injectable()
export class AnalyticsRepository {
  constructor(private readonly rls: RlsTransaction) {}

  snapshot(
    organizationId: string,
    range: AnalyticsRange,
    domains: ReadonlySet<AnalyticsDomain>,
  ): Promise<AnalyticsSnapshot> {
    return this.rls.run(async (tx) => {
      const scope = {
        organizationId,
        deletedAt: null,
        businessUnitId: range.businessUnitId,
      };
      const organization = await tx.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
        select: { id: true, primarySegment: true },
      });
      if (!organization)
        throw new EntityNotFoundException('Organization', organizationId);
      // Include old open work and work delivered during either period. Filtering
      // only by creation time hid the backlog and completions of older orders.
      const operations =
        domains.has('OPERATIONS') || domains.has('TECHNICIANS')
          ? (
              await tx.operation.findMany({
                where: {
                  ...scope,
                  createdAt: { lte: range.to },
                  OR: [
                    { createdAt: { gte: range.previousFrom } },
                    { completedAt: { gte: range.previousFrom } },
                    { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
                  ],
                },
                select: operationSelect,
                orderBy: { createdAt: 'asc' },
              })
            ).map((operation) => ({ ...operation, users: [] }))
          : [];
      // A civil due date is not an instant at midnight UTC. Pad the DB range,
      // then evaluate the exact deadline in each contract's timezone.
      const dateFrom = new Date(range.previousFrom);
      dateFrom.setUTCDate(dateFrom.getUTCDate() - 1);
      const dateTo = new Date(range.to);
      dateTo.setUTCDate(dateTo.getUTCDate() + 1);
      const pmocRows = domains.has('PMOC')
        ? await tx.pmocExecution.findMany({
            where: {
              organizationId,
              dueOn: { lte: dateTo },
              OR: [
                { dueOn: { gte: dateFrom, lte: dateTo } },
                { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
                { performedAt: { gte: range.previousFrom } },
              ],
              plan: { businessUnitId: range.businessUnitId, deletedAt: null },
            },
            select: {
              status: true,
              dueOn: true,
              performedAt: true,
              plan: {
                select: { businessUnit: { select: { timezone: true } } },
              },
            },
          })
        : [];
      const endOfDay = (day: string, timezone: string) =>
        new Date(
          addCivilDays(
            instantFromCivilDate(day, timezone),
            1,
            timezone,
          ).getTime() - 1,
        );
      const pmocs: AnalyticsCommitment[] = pmocRows.map((row) => ({
        status: row.status,
        createdAt: instantFromCivilDate(
          row.dueOn.toISOString().slice(0, 10),
          row.plan.businessUnit.timezone,
        ),
        deadlineAt: endOfDay(
          row.dueOn.toISOString().slice(0, 10),
          row.plan.businessUnit.timezone,
        ),
        finalizedAt: row.performedAt,
      }));
      const rvtRows = domains.has('RVT')
        ? await tx.rvtOccurrence.findMany({
            where: {
              ...scope,
              configuration: { deletedAt: null },
              AND: [
                {
                  OR: [
                    { scheduledFor: { lte: range.to } },
                    { scheduledFor: null, localScheduledDate: { lte: dateTo } },
                  ],
                },
              ],
              OR: [
                { scheduledFor: { gte: range.previousFrom, lte: range.to } },
                {
                  scheduledFor: null,
                  localScheduledDate: { gte: dateFrom, lte: dateTo },
                },
                { status: { notIn: ['COMPLETED', 'CANCELLED'] } },
                { execution: { completedAt: { gte: range.previousFrom } } },
              ],
            },
            select: {
              status: true,
              scheduledFor: true,
              localScheduledDate: true,
              configuration: { select: { timezone: true } },
              execution: { select: { completedAt: true } },
            },
          })
        : [];
      const rvts: AnalyticsCommitment[] = rvtRows.flatMap((row) => {
        // scheduledFor is the START of the visit, not its completion deadline.
        // With no contracted end instant, evaluate fulfillment on the local day.
        const day = row.scheduledFor
          ? civilDateKey(row.scheduledFor, row.configuration.timezone)
          : row.localScheduledDate?.toISOString().slice(0, 10);
        const deadlineAt = day
          ? endOfDay(day, row.configuration.timezone)
          : null;
        return deadlineAt
          ? [
              {
                status: row.status,
                createdAt: deadlineAt,
                deadlineAt,
                finalizedAt: row.execution?.completedAt ?? null,
              },
            ]
          : [];
      });
      const assets = domains.has('EQUIPMENT')
        ? await tx.asset.findMany({ where: scope, select: { status: true } })
        : [];
      return {
        organization: {
          id: organization.id,
          segment: organization.primarySegment,
        },
        range,
        operations,
        previousOperations: operations.filter(
          (operation) => operation.createdAt <= range.previousTo,
        ),
        pmocs,
        previousPmocs: pmocs,
        rvts,
        previousRvts: rvts,
        assets,
        customers: [],
      };
    });
  }
}
