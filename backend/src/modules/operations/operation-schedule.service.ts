import { Injectable } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import { ValidationException } from '../../exceptions';
import { RecurrenceEngine } from '../scheduling/recurrence.engine';
import type { CheckOperationScheduleDto } from './dto/operation-schedule.dto';
import type { OperationScheduleWarningReadModel } from './operation.read-models';

export const SCHEDULE_NOTICE_MARGIN_MS = 10 * 60_000;
export function schedulesAreClose(
  start: Date,
  end: Date | null | undefined,
  otherStart: Date,
  otherEnd: Date | null | undefined,
) {
  return (
    start.getTime() <=
      (otherEnd ?? otherStart).getTime() + SCHEDULE_NOTICE_MARGIN_MS &&
    otherStart.getTime() <= (end ?? start).getTime() + SCHEDULE_NOTICE_MARGIN_MS
  );
}

/** Consulta consultiva: a confirmação do gestor pode prosseguir com o horário. */
@Injectable()
export class OperationScheduleService {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly recurrence: RecurrenceEngine,
  ) {}
  check(organizationId: string, input: CheckOperationScheduleDto) {
    if (input.scheduledEnd && input.scheduledEnd <= input.scheduledStart)
      throw new ValidationException(
        'O término previsto deve ser posterior ao início.',
      );
    if (
      input.scheduledEnd &&
      input.scheduledEnd.getTime() - input.scheduledStart.getTime() >
        366 * 86400_000
    )
      throw new ValidationException(
        'A janela prevista deve ter no máximo 366 dias.',
      );
    const userIds = [...new Set(input.userIds)];
    const from = new Date(
      input.scheduledStart.getTime() - SCHEDULE_NOTICE_MARGIN_MS - 1,
    );
    const to = new Date(
      (input.scheduledEnd ?? input.scheduledStart).getTime() +
        SCHEDULE_NOTICE_MARGIN_MS +
        1,
    );
    return this.rls.run(async (tx) => {
      const operations = await tx.operation.findMany({
        where: {
          organizationId,
          deletedAt: null,
          id: input.excludeOperationId
            ? { not: input.excludeOperationId }
            : undefined,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
          scheduledStart: { lte: to },
          AND: [
            {
              OR: [
                { responsibleFieldTechnicianId: { in: userIds } },
                {
                  auxiliaryTechnicians: {
                    some: { userId: { in: userIds }, removedAt: null },
                  },
                },
              ],
            },
            {
              OR: [
                { scheduledEnd: { gte: from } },
                { scheduledEnd: null, scheduledStart: { gte: from } },
              ],
            },
          ],
        },
        select: {
          id: true,
          title: true,
          code: true,
          scheduledStart: true,
          scheduledEnd: true,
          responsibleFieldTechnician: {
            select: { id: true, displayName: true },
          },
          auxiliaryTechnicians: {
            where: { removedAt: null, userId: { in: userIds } },
            select: { user: { select: { id: true, displayName: true } } },
          },
        },
      });
      const events = await tx.schedulingEvent.findMany({
        where: {
          id: input.excludeEventId ? { not: input.excludeEventId } : undefined,
          organizationId,
          deletedAt: null,
          status: { notIn: ['CANCELLED', 'COMPLETED'] },
          startsAt: { lte: to },
          allocations: {
            some: {
              userId: { in: userIds },
              deletedAt: null,
              status: { notIn: ['CANCELLED', 'RELEASED'] },
            },
          },
          OR: [{ endsAt: { gte: from } }, { recurrence: { isNot: null } }],
          NOT: input.excludeOperationId
            ? {
                sourceModule: 'operations',
                sourceEntityId: input.excludeOperationId,
              }
            : undefined,
        },
        include: {
          recurrence: true,
          allocations: {
            where: {
              userId: { in: userIds },
              deletedAt: null,
              status: { notIn: ['CANCELLED', 'RELEASED'] },
            },
            include: { user: { select: { id: true, displayName: true } } },
          },
        },
      });
      const warnings = new Map<string, OperationScheduleWarningReadModel>();
      for (const operation of operations) {
        if (
          !operation.scheduledStart ||
          !schedulesAreClose(
            input.scheduledStart,
            input.scheduledEnd,
            operation.scheduledStart,
            operation.scheduledEnd,
          )
        )
          continue;
        const people = [
          operation.responsibleFieldTechnician,
          ...operation.auxiliaryTechnicians.map((item) => item.user),
        ];
        for (const user of people)
          if (user && userIds.includes(user.id))
            warnings.set(`${operation.id}:${user.id}`, {
              userName: user.displayName,
              title: `${operation.code} · ${operation.title}`,
              startsAt: operation.scheduledStart.toISOString(),
              endsAt: operation.scheduledEnd?.toISOString() ?? null,
            });
      }
      for (const event of events) {
        const rule = event.recurrence;
        const matches = this.recurrence.expand(
          event.startsAt,
          event.endsAt,
          rule,
          from,
          to,
        );
        for (const occurrence of matches) {
          if (
            !schedulesAreClose(
              input.scheduledStart,
              input.scheduledEnd,
              occurrence.startsAt,
              occurrence.endsAt,
            )
          )
            continue;
          for (const allocation of event.allocations)
            if (allocation.user) {
              const key = `${event.sourceModule === 'operations' ? (event.sourceEntityId ?? event.id) : event.id}:${allocation.user.id}`;
              if (!warnings.has(key))
                warnings.set(key, {
                  userName: allocation.user.displayName,
                  title: event.title,
                  startsAt: occurrence.startsAt.toISOString(),
                  endsAt: occurrence.endsAt.toISOString(),
                });
            }
        }
      }
      return [...warnings.values()].sort((a, b) =>
        a.startsAt.localeCompare(b.startsAt),
      );
    });
  }
}
