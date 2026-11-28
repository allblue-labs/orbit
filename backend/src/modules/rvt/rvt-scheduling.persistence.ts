import type { PrismaTransactionClient } from '../../database/prisma.types';
import { rvtJson } from './rvt-json';

type RvtSchedulingProjection = {
  existingId?: string | null;
  occurrenceId: string;
  organizationId: string;
  businessUnitId: string;
  customerId: string;
  actorId: string;
  calendarId: string;
  title: string;
  startsAt: Date;
  timezone: string;
  location: unknown;
  responsibleUserId: string | null;
};

export async function resolveRvtCalendar(
  tx: PrismaTransactionClient,
  organizationId: string,
  businessUnitId: string,
  timezone: string,
  calendarId?: string | null,
) {
  if (calendarId) {
    const selected = await tx.schedulingCalendar.findFirst({
      where: {
        id: calendarId,
        organizationId,
        isActive: true,
        deletedAt: null,
        OR: [{ businessUnitId }, { businessUnitId: null }],
      },
    });
    if (!selected) throw new Error('RVT_CALENDAR_INVALID');
    return selected;
  }
  const existing = await tx.schedulingCalendar.findFirst({
    where: {
      organizationId,
      isActive: true,
      deletedAt: null,
      OR: [{ businessUnitId }, { businessUnitId: null }],
    },
    orderBy: [{ businessUnitId: 'desc' }, { isDefault: 'desc' }],
  });
  if (existing) return existing;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:calendar:${organizationId}:${businessUnitId}`}))`;
  const concurrent = await tx.schedulingCalendar.findFirst({
    where: {
      organizationId,
      businessUnitId,
      isActive: true,
      deletedAt: null,
    },
  });
  if (concurrent) return concurrent;
  return tx.schedulingCalendar.create({
    data: {
      organizationId,
      businessUnitId,
      key: `rvt-${businessUnitId}`,
      name: 'Visitas técnicas',
      description: 'Agenda autoritativa das ocorrências RVT',
      timezone,
      isDefault: false,
      isActive: true,
    },
  });
}

export async function projectRvtOccurrence(
  tx: PrismaTransactionClient,
  input: RvtSchedulingProjection,
) {
  const event = await tx.schedulingEvent.upsert({
    where: { id: input.existingId ?? '00000000-0000-0000-0000-000000000000' },
    create: {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId,
      calendarId: input.calendarId,
      customerId: input.customerId,
      createdById: input.actorId,
      title: input.title,
      description: 'Visita técnica programada pelo domínio RVT',
      type: 'TECHNICAL_VISIT',
      status: 'CONFIRMED',
      priority: 'NORMAL',
      startsAt: input.startsAt,
      endsAt: new Date(input.startsAt.getTime() + 60 * 60_000),
      allDay: false,
      timezone: input.timezone,
      sourceModule: 'RVT',
      sourceEntityType: 'RVT_OCCURRENCE',
      sourceEntityId: input.occurrenceId,
      location: rvtJson(input.location),
      metadata: rvtJson({ occurrenceId: input.occurrenceId }),
    },
    update: {
      calendarId: input.calendarId,
      startsAt: input.startsAt,
      endsAt: new Date(input.startsAt.getTime() + 60 * 60_000),
      status: 'CONFIRMED',
      deletedAt: null,
      title: input.title,
      timezone: input.timezone,
      location: rvtJson(input.location),
    },
    select: { id: true },
  });
  await tx.schedulingResourceAllocation.deleteMany({
    where: { eventId: event.id },
  });
  if (input.responsibleUserId)
    await tx.schedulingResourceAllocation.create({
      data: {
        eventId: event.id,
        userId: input.responsibleUserId,
        resourceType: 'USER',
        role: 'FIELD_TECHNICIAN',
        status: 'ALLOCATED',
      },
    });
  return event.id;
}
