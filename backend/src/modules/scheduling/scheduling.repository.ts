import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import type { AvailabilityQueryDto, EventQueryDto } from './dto/scheduling.dto';

const eventInclude = {
  calendar: {
    select: { id: true, key: true, name: true, color: true, timezone: true },
  },
  recurrence: true,
  allocations: {
    where: { deletedAt: null },
    include: {
      user: { select: { id: true, displayName: true, avatarUrl: true } },
      asset: { select: { id: true, name: true, identifier: true } },
    },
  },
  customer: { select: { id: true, legalName: true, tradeName: true } },
  asset: { select: { id: true, name: true, identifier: true } },
  createdBy: { select: { id: true, displayName: true } },
} satisfies Prisma.SchedulingEventInclude;

@Injectable()
export class SchedulingRepository {
  constructor(private readonly rls: RlsTransaction) {}

  listCalendars(organizationId: string, businessUnitId?: string) {
    return this.rls.run((tx) =>
      tx.schedulingCalendar.findMany({
        where: {
          organizationId,
          deletedAt: null,
          OR: businessUnitId
            ? [{ businessUnitId: null }, { businessUnitId }]
            : undefined,
        },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
    );
  }

  /** Personal view preference, then unit, default calendar and fallback. */
  agendaTimezone(
    organizationId: string,
    businessUnitId?: string,
    viewerId?: string,
  ) {
    return this.rls.run(async (tx) => {
      if (viewerId) {
        const viewer = await tx.user.findFirst({
          where: { id: viewerId, deletedAt: null },
          select: { timezone: true },
        });
        if (viewer?.timezone) {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: viewer.timezone });
            return viewer.timezone;
          } catch {
            // Invalid legacy values fall through to the organization's defaults.
          }
        }
      }
      if (businessUnitId) {
        const unit = await tx.businessUnit.findFirst({
          where: { id: businessUnitId, organizationId, deletedAt: null },
          select: { timezone: true },
        });
        if (unit?.timezone) return unit.timezone;
      }
      const calendar = await tx.schedulingCalendar.findFirst({
        where: {
          organizationId,
          deletedAt: null,
          isActive: true,
          isDefault: true,
          OR: businessUnitId
            ? [{ businessUnitId }, { businessUnitId: null }]
            : [{ businessUnitId: null }],
        },
        select: { timezone: true },
      });
      return calendar?.timezone ?? 'America/Recife';
    });
  }

  findCalendar(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.schedulingCalendar.findFirst({
        where: { id, organizationId, deletedAt: null },
      }),
    );
  }

  createCalendar(data: Prisma.SchedulingCalendarUncheckedCreateInput) {
    return this.rls.run(async (tx) => {
      if (data.isDefault)
        await tx.schedulingCalendar.updateMany({
          where: {
            organizationId: data.organizationId,
            businessUnitId: data.businessUnitId ?? null,
            isDefault: true,
            deletedAt: null,
          },
          data: { isDefault: false },
        });
      return tx.schedulingCalendar.create({ data });
    });
  }

  updateCalendar(
    id: string,
    organizationId: string,
    businessUnitId: string | null,
    data: Prisma.SchedulingCalendarUpdateInput,
  ) {
    return this.rls.run(async (tx) => {
      if (data.isDefault === true)
        await tx.schedulingCalendar.updateMany({
          where: {
            id: { not: id },
            organizationId,
            businessUnitId,
            isDefault: true,
            deletedAt: null,
          },
          data: { isDefault: false },
        });
      return tx.schedulingCalendar.update({ where: { id }, data });
    });
  }

  deleteCalendar(id: string) {
    return this.rls.run((tx) =>
      tx.schedulingCalendar.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false, isDefault: false },
      }),
    );
  }

  findEvent(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.schedulingEvent.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: eventInclude,
      }),
    );
  }

  candidateEvents(organizationId: string, query: EventQueryDto) {
    return this.rls.run((tx) =>
      tx.schedulingEvent.findMany({
        where: {
          organizationId,
          deletedAt: null,
          calendarId: query.calendarId,
          businessUnitId: query.businessUnitId,
          customerId: query.customerId,
          assetId: query.assetId,
          segment: query.segment,
          status: query.status,
          startsAt: { lt: query.to },
          OR: [{ endsAt: { gt: query.from } }, { recurrence: { isNot: null } }],
          allocations: query.userId
            ? {
                some: {
                  userId: query.userId,
                  status: 'ALLOCATED',
                  deletedAt: null,
                },
              }
            : undefined,
        },
        include: eventInclude,
        orderBy: { startsAt: 'asc' },
      }),
    );
  }

  createEvent(
    data: Prisma.SchedulingEventUncheckedCreateInput,
    recurrence:
      Prisma.SchedulingRecurrenceUncheckedCreateWithoutEventInput | undefined,
    allocations: Prisma.SchedulingResourceAllocationUncheckedCreateWithoutEventInput[],
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      const event = await tx.schedulingEvent.create({
        data: {
          ...data,
          recurrence: recurrence ? { create: recurrence } : undefined,
          allocations: allocations.length ? { create: allocations } : undefined,
        },
        include: eventInclude,
      });
      await tx.schedulingEventHistory.create({
        data: {
          eventId: event.id,
          userId: actorId,
          action: 'CREATED',
          details: {
            sourceModule: event.sourceModule,
            sourceEntityType: event.sourceEntityType,
          },
        },
      });
      return event;
    });
  }

  updateEvent(
    id: string,
    data: Prisma.SchedulingEventUpdateInput,
    recurrence:
      | Prisma.SchedulingRecurrenceUncheckedCreateWithoutEventInput
      | null
      | undefined,
    allocations:
      | Prisma.SchedulingResourceAllocationUncheckedCreateWithoutEventInput[]
      | undefined,
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      if (recurrence !== undefined) {
        await tx.schedulingRecurrence.deleteMany({ where: { eventId: id } });
        if (recurrence)
          await tx.schedulingRecurrence.create({
            data: { ...recurrence, eventId: id },
          });
      }
      if (allocations !== undefined) {
        await tx.schedulingResourceAllocation.updateMany({
          where: { eventId: id, deletedAt: null },
          data: { deletedAt: new Date(), status: 'RELEASED' },
        });
        if (allocations.length)
          await tx.schedulingResourceAllocation.createMany({
            data: allocations.map((allocation) => ({
              ...allocation,
              eventId: id,
            })),
          });
      }
      const event = await tx.schedulingEvent.update({
        where: { id },
        data,
        include: eventInclude,
      });
      await tx.schedulingEventHistory.create({
        data: {
          eventId: id,
          userId: actorId,
          action: 'UPDATED',
          details: { changedFields: Object.keys(data) },
        },
      });
      return event;
    });
  }

  deleteEvent(id: string, actorId: string) {
    return this.rls.run(async (tx) => {
      await tx.schedulingEventHistory.create({
        data: { eventId: id, userId: actorId, action: 'DELETED' },
      });
      await tx.schedulingEvent.update({
        where: { id },
        data: { deletedAt: new Date(), status: 'CANCELLED' },
      });
    });
  }

  addAllocation(
    data: Prisma.SchedulingResourceAllocationUncheckedCreateInput,
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      const allocation = await tx.schedulingResourceAllocation.create({
        data,
      });
      await tx.schedulingEventHistory.create({
        data: {
          eventId: data.eventId,
          userId: actorId,
          action: 'RESOURCE_ALLOCATED',
          details: {
            allocationId: allocation.id,
            resourceType: allocation.resourceType,
          },
        },
      });
      return allocation;
    });
  }

  removeAllocation(id: string, eventId: string, actorId: string) {
    return this.rls.run(async (tx) => {
      const result = await tx.schedulingResourceAllocation.updateMany({
        where: { id, eventId, deletedAt: null },
        data: { deletedAt: new Date(), status: 'RELEASED' },
      });
      if (result.count)
        await tx.schedulingEventHistory.create({
          data: {
            eventId,
            userId: actorId,
            action: 'RESOURCE_RELEASED',
            details: { allocationId: id },
          },
        });
      return result.count;
    });
  }

  listAvailability(organizationId: string, query: AvailabilityQueryDto) {
    return this.rls.run((tx) =>
      tx.schedulingAvailability.findMany({
        where: {
          organizationId,
          deletedAt: null,
          businessUnitId: query.businessUnitId,
          userId: query.userId,
          resourceType: query.resourceType,
          resourceKey: query.resourceKey,
        },
        orderBy: [
          { userId: 'asc' },
          { resourceType: 'asc' },
          { dayOfWeek: 'asc' },
          { date: 'asc' },
          { startMinute: 'asc' },
        ],
      }),
    );
  }

  createAvailability(data: Prisma.SchedulingAvailabilityUncheckedCreateInput) {
    return this.rls.run((tx) => tx.schedulingAvailability.create({ data }));
  }

  availabilityForResources(
    organizationId: string,
    resources: {
      userIds: string[];
      resourceKeys: string[];
    },
    from: Date,
    to: Date,
  ) {
    // `date` é DATE civil, enquanto from/to são instantes. Como cada regra
    // pode ter seu próprio timezone, uma margem indexável de um dia busca os
    // candidatos; `ruleApplies` faz a comparação civil exata em memória.
    const dateFrom = new Date(from.getTime() - 86_400_000);
    const dateTo = new Date(to.getTime() + 86_400_000);
    return this.rls.run((tx) =>
      tx.schedulingAvailability.findMany({
        where: {
          organizationId,
          deletedAt: null,
          OR: [
            ...(resources.userIds.length
              ? [{ userId: { in: resources.userIds } }]
              : []),
            ...(resources.resourceKeys.length
              ? [{ resourceKey: { in: resources.resourceKeys } }]
              : []),
          ],
          AND: [
            {
              OR: [{ date: null }, { date: { gte: dateFrom, lt: dateTo } }],
            },
            {
              OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: to } }],
            },
            {
              OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: from } }],
            },
          ],
        },
      }),
    );
  }

  deleteAvailability(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.schedulingAvailability.updateMany({
        where: { id, organizationId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );
  }

  eventTimeline(eventId: string) {
    return this.rls.run((tx) =>
      tx.schedulingEventHistory.findMany({
        where: { eventId },
        include: { user: { select: { id: true, displayName: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async references(
    organizationId: string,
    input: {
      businessUnitId?: string;
      customerId?: string;
      assetId?: string;
      userIds: string[];
      allocationAssetIds: string[];
    },
  ) {
    return this.rls.run(async (tx) => {
      /**
       * Cinco verificações, uma de cada vez.
       *
       * Compartilham o mesmo cliente transacional — o `pg` já as serializava
       * internamente, então o `Promise.all` só prendia a conexão por todo o
       * intervalo sem ganho nenhum. Ver `docs/transaction-concurrency.md`.
       */
      const businessUnit = input.businessUnitId
        ? await tx.businessUnit.findFirst({
            where: {
              id: input.businessUnitId,
              organizationId,
              deletedAt: null,
              status: 'ACTIVE',
            },
            select: { id: true },
          })
        : null;
      const customer = input.customerId
        ? await tx.customer.findFirst({
            where: { id: input.customerId, organizationId, deletedAt: null },
            select: { id: true },
          })
        : null;
      const asset = input.assetId
        ? await tx.asset.findFirst({
            where: { id: input.assetId, organizationId, deletedAt: null },
            select: { id: true, businessUnitId: true, customerId: true },
          })
        : null;
      const users = input.userIds.length
        ? await tx.organizationMembership.findMany({
            where: {
              organizationId,
              userId: { in: input.userIds },
              status: 'ACTIVE',
              deletedAt: null,
            },
            select: { userId: true },
          })
        : [];
      const allocationAssets = input.allocationAssetIds.length
        ? await tx.asset.findMany({
            where: {
              id: { in: input.allocationAssetIds },
              organizationId,
              deletedAt: null,
            },
            select: { id: true },
          })
        : [];
      return { businessUnit, customer, asset, users, allocationAssets };
    });
  }

  organizationSegment(organizationId: string) {
    return this.rls.run((tx) =>
      tx.organization.findFirst({
        where: { id: organizationId, deletedAt: null },
        select: { primarySegment: true },
      }),
    );
  }
}
