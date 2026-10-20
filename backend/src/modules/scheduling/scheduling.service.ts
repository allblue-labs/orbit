import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import type {
  AddAllocationDto,
  AgendaQueryDto,
  AvailabilityQueryDto,
  CreateAvailabilityDto,
  CreateCalendarDto,
  CreateEventDto,
  EventQueryDto,
  RecurrenceDto,
  ResourceAllocationDto,
  UpdateCalendarDto,
  UpdateEventDto,
} from './dto/scheduling.dto';
import { RecurrenceFrequency, ResourceType } from './dto/scheduling.dto';
import { RecurrenceEngine, type RecurrenceRule } from './recurrence.engine';
import type {
  AgendaReadModel,
  DashboardSchedulingReadModel,
  SchedulingConflictReadModel,
  SchedulingIntelligenceReadModel,
  SchedulingOccurrenceReadModel,
  SchedulingTimelineReadModel,
} from './scheduling.read-models';
import { SchedulingRepository } from './scheduling.repository';
import {
  addCivilDays,
  assertIanaTimezone,
  availabilityRuleApplies,
  civilDateKey,
  civilMinute,
  localViewRange,
} from './scheduling-time';
import { OperationService } from '../operations/operation.service';
import { WorkforceRepository } from '../workforce/workforce.repository';

type SchedulingEventRecord = NonNullable<
  Awaited<ReturnType<SchedulingRepository['findEvent']>>
>;

@Injectable()
export class SchedulingService {
  constructor(
    private readonly repository: SchedulingRepository,
    private readonly recurrence: RecurrenceEngine,
    private readonly operations: OperationService,
    private readonly workforce: WorkforceRepository,
  ) {}

  listCalendars(organizationId: string, businessUnitId?: string) {
    return this.repository.listCalendars(organizationId, businessUnitId);
  }

  async getCalendar(id: string, organizationId: string) {
    const calendar = await this.repository.findCalendar(id, organizationId);
    if (!calendar) throw new EntityNotFoundException('Calendar', id);
    return calendar;
  }

  async createCalendar(organizationId: string, input: CreateCalendarDto) {
    if (input.businessUnitId)
      await this.validateReferences(organizationId, {
        businessUnitId: input.businessUnitId,
        userIds: [],
        allocationAssetIds: [],
      });
    try {
      return await this.repository.createCalendar({
        organizationId,
        businessUnitId: input.businessUnitId,
        key: input.key.trim().toUpperCase(),
        name: input.name.trim(),
        description: input.description?.trim(),
        color: input.color?.toUpperCase(),
        timezone: input.timezone,
        isDefault: input.isDefault ?? false,
        isActive: input.isActive ?? true,
      });
    } catch (error) {
      this.mapConflict(error, 'Calendar key already exists');
    }
  }

  async updateCalendar(
    id: string,
    organizationId: string,
    input: UpdateCalendarDto,
  ) {
    const current = await this.getCalendar(id, organizationId);
    if (input.businessUnitId)
      await this.validateReferences(organizationId, {
        businessUnitId: input.businessUnitId,
        userIds: [],
        allocationAssetIds: [],
      });
    try {
      return await this.repository.updateCalendar(
        id,
        organizationId,
        input.businessUnitId ?? current.businessUnitId,
        {
          businessUnit: input.businessUnitId
            ? { connect: { id: input.businessUnitId } }
            : undefined,
          key: input.key?.trim().toUpperCase(),
          name: input.name?.trim(),
          description: input.description?.trim(),
          color: input.color?.toUpperCase(),
          timezone: input.timezone,
          isDefault: input.isDefault,
          isActive: input.isActive,
        },
      );
    } catch (error) {
      this.mapConflict(error, 'Calendar key already exists');
    }
  }

  async removeCalendar(id: string, organizationId: string) {
    const calendar = await this.getCalendar(id, organizationId);
    if (calendar.isDefault)
      throw new ConflictException('Default calendar cannot be removed');
    await this.repository.deleteCalendar(id);
  }

  async getEvent(id: string, organizationId: string) {
    const event = await this.repository.findEvent(id, organizationId);
    if (!event) throw new EntityNotFoundException('Scheduling event', id);
    return event;
  }

  async createEvent(
    organizationId: string,
    actorId: string,
    input: CreateEventDto,
  ) {
    this.validateEvent(input);
    const [calendar, organization] = await Promise.all([
      this.getCalendar(input.calendarId, organizationId),
      this.repository.organizationSegment(organizationId),
    ]);
    if (!calendar.isActive)
      throw new ValidationException('Active calendar is required');
    if (
      calendar.businessUnitId &&
      input.businessUnitId !== calendar.businessUnitId
    )
      throw new ValidationException(
        'Event must use the calendar business unit',
      );
    await this.validateReferences(organizationId, this.referenceInput(input));
    const allocations = await this.authoritativeAllocations(
      organizationId,
      input,
    );
    const conflicts = await this.detectInputConflicts(organizationId, {
      ...input,
      allocations,
    });
    this.assertConflicts(conflicts, input.allowConflicts);
    return this.repository.createEvent(
      {
        organizationId,
        businessUnitId: input.businessUnitId,
        calendarId: input.calendarId,
        customerId: input.customerId,
        assetId: input.assetId,
        createdById: actorId,
        title: input.title.trim(),
        description: input.description?.trim(),
        type: input.type.trim().toUpperCase(),
        status: input.status ?? 'CONFIRMED',
        priority: input.priority ?? 'NORMAL',
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        allDay: input.allDay ?? false,
        timezone: input.timezone,
        segment: (input.segment ?? organization?.primarySegment ?? 'GENERAL')
          .trim()
          .toUpperCase(),
        sourceModule: input.sourceModule.trim().toLowerCase(),
        sourceEntityType: input.sourceEntityType.trim().toUpperCase(),
        sourceEntityId: input.sourceEntityId,
        location: input.location as Prisma.InputJsonValue | undefined,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
      this.recurrenceData(input.recurrence),
      this.allocationData(allocations),
      actorId,
    );
  }

  async updateEvent(
    id: string,
    organizationId: string,
    actorId: string,
    input: UpdateEventDto,
  ) {
    const current = await this.getEvent(id, organizationId);
    if (input.clearRecurrence && input.recurrence)
      throw new ValidationException(
        'Use recurrence or clearRecurrence, not both',
      );
    const merged = this.mergeEvent(current, input);
    this.validateEvent(merged);
    const calendar = await this.getCalendar(merged.calendarId, organizationId);
    if (
      calendar.businessUnitId &&
      merged.businessUnitId !== calendar.businessUnitId
    )
      throw new ValidationException(
        'Event must use the calendar business unit',
      );
    await this.validateReferences(organizationId, this.referenceInput(merged));
    const conflicts = await this.detectInputConflicts(
      organizationId,
      merged,
      id,
    );
    this.assertConflicts(conflicts, input.allowConflicts);
    return this.repository.updateEvent(
      id,
      {
        calendar: input.calendarId
          ? { connect: { id: input.calendarId } }
          : undefined,
        businessUnit: input.businessUnitId
          ? { connect: { id: input.businessUnitId } }
          : undefined,
        customer: input.customerId
          ? { connect: { id: input.customerId } }
          : undefined,
        asset: input.assetId ? { connect: { id: input.assetId } } : undefined,
        title: input.title?.trim(),
        description: input.description?.trim(),
        type: input.type?.trim().toUpperCase(),
        status: input.status,
        priority: input.priority,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        allDay: input.allDay,
        timezone: input.timezone,
        segment: input.segment?.trim().toUpperCase(),
        sourceModule: input.sourceModule?.trim().toLowerCase(),
        sourceEntityType: input.sourceEntityType?.trim().toUpperCase(),
        sourceEntityId: input.sourceEntityId,
        location: input.location as Prisma.InputJsonValue | undefined,
        metadata: input.metadata as Prisma.InputJsonValue | undefined,
      },
      input.clearRecurrence
        ? null
        : input.recurrence === undefined
          ? undefined
          : this.recurrenceData(input.recurrence),
      input.allocations === undefined
        ? undefined
        : this.allocationData(input.allocations),
      actorId,
    );
  }

  async removeEvent(id: string, organizationId: string, actorId: string) {
    await this.getEvent(id, organizationId);
    await this.repository.deleteEvent(id, actorId);
  }

  async occurrences(
    organizationId: string,
    query: EventQueryDto,
  ): Promise<SchedulingOccurrenceReadModel[]> {
    this.validateRange(query.from, query.to);
    const events = await this.repository.candidateEvents(organizationId, query);
    return events
      .flatMap((event) => this.expandEvent(event, query.from, query.to))
      .sort(
        (left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt),
      );
  }

  async agenda(
    organizationId: string,
    query: AgendaQueryDto,
  ): Promise<AgendaReadModel> {
    const timezone = await this.repository.agendaTimezone(
      organizationId,
      query.businessUnitId,
    );
    assertIanaTimezone(timezone);
    const range = localViewRange(query.view, query.date, timezone);
    const events = await this.occurrences(organizationId, {
      from: range.from,
      to: range.to,
      businessUnitId: query.businessUnitId,
      userId: query.userId,
      customerId: query.customerId,
      assetId: query.assetId,
      segment: query.segment,
    });
    const days = new Map<string, SchedulingOccurrenceReadModel[]>();
    for (const event of events) {
      const date = civilDateKey(new Date(event.startsAt), timezone);
      days.set(date, [...(days.get(date) ?? []), event]);
    }
    return {
      view: query.view as AgendaReadModel['view'],
      range: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        timezone,
      },
      summary: {
        total: events.length,
        confirmed: events.filter((event) => event.status === 'CONFIRMED')
          .length,
        tentative: events.filter((event) => event.status === 'TENTATIVE')
          .length,
        blocked: events.filter((event) => event.type === 'BLOCK').length,
        hoursAllocated:
          Math.round(
            events.reduce(
              (total, event) =>
                total +
                (Date.parse(event.endsAt) - Date.parse(event.startsAt)) /
                  3_600_000,
              0,
            ) * 100,
          ) / 100,
      },
      days: [...days.entries()].map(([date, dayEvents]) => ({
        date,
        events: dayEvents,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  async timeline(
    id: string,
    organizationId: string,
  ): Promise<SchedulingTimelineReadModel> {
    const event = await this.getEvent(id, organizationId);
    const history = await this.repository.eventTimeline(id);
    return {
      eventId: id,
      event: {
        id,
        title: event.title,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        status: event.status,
      },
      history: history.map((entry) => ({
        id: entry.id,
        action: entry.action,
        actor: entry.user
          ? { id: entry.user.id, name: entry.user.displayName }
          : null,
        details: entry.details,
        createdAt: entry.createdAt.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  listAvailability(organizationId: string, query: AvailabilityQueryDto) {
    return this.repository.listAvailability(organizationId, query);
  }

  async createAvailability(
    organizationId: string,
    input: CreateAvailabilityDto,
  ) {
    this.validateAvailability(input);
    await this.validateReferences(organizationId, {
      businessUnitId: input.businessUnitId,
      userIds: input.userId ? [input.userId] : [],
      allocationAssetIds:
        input.resourceType === ResourceType.ASSET && input.resourceKey
          ? [input.resourceKey]
          : [],
    });
    return this.repository.createAvailability({
      organizationId,
      businessUnitId: input.businessUnitId,
      userId: input.userId,
      resourceType: input.resourceType,
      resourceKey: input.resourceKey,
      kind: input.kind,
      dayOfWeek: input.dayOfWeek,
      date: input.date,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      timezone: input.timezone,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil,
      reason: input.reason?.trim(),
    });
  }

  async removeAvailability(id: string, organizationId: string) {
    const count = await this.repository.deleteAvailability(id, organizationId);
    if (count.count !== 1)
      throw new EntityNotFoundException('Scheduling availability', id);
  }

  async addAllocation(
    eventId: string,
    organizationId: string,
    actorId: string,
    input: AddAllocationDto,
  ) {
    const event = await this.getEvent(eventId, organizationId);
    this.validateAllocations([input.allocation]);
    await this.validateReferences(organizationId, {
      userIds: input.allocation.userId ? [input.allocation.userId] : [],
      allocationAssetIds: input.allocation.assetId
        ? [input.allocation.assetId]
        : [],
    });
    const proposed = this.mergeEvent(event, {
      allocations: [
        ...event.allocations.map((allocation) => ({
          resourceType: allocation.resourceType,
          userId: allocation.userId ?? undefined,
          assetId: allocation.assetId ?? undefined,
          resourceKey: allocation.resourceKey ?? undefined,
          role: allocation.role ?? undefined,
        })),
        input.allocation,
      ],
    });
    this.validateAllocations(proposed.allocations ?? []);
    const conflicts = await this.detectInputConflicts(
      organizationId,
      proposed,
      eventId,
    );
    this.assertConflicts(conflicts, input.allowConflicts);
    return this.repository.addAllocation(
      {
        eventId,
        ...this.allocationData([input.allocation])[0]!,
      },
      actorId,
    );
  }

  async removeAllocation(
    eventId: string,
    allocationId: string,
    organizationId: string,
    actorId: string,
  ) {
    await this.getEvent(eventId, organizationId);
    const count = await this.repository.removeAllocation(
      allocationId,
      eventId,
      actorId,
    );
    if (count !== 1)
      throw new EntityNotFoundException('Resource allocation', allocationId);
  }

  async conflicts(organizationId: string, query: EventQueryDto) {
    this.validateRange(query.from, query.to);
    const records = await this.repository.candidateEvents(
      organizationId,
      query,
    );
    const events = records.flatMap((event) =>
      this.expandEvent(event, query.from, query.to),
    );
    const availability = await Promise.all(
      records.map((event) =>
        this.availabilityConflicts(organizationId, event, query.from, query.to),
      ),
    );
    return [...this.conflictsBetween(events), ...availability.flat()];
  }

  async intelligence(
    organizationId: string,
    query: EventQueryDto,
  ): Promise<SchedulingIntelligenceReadModel> {
    const [events, conflicts, organization] = await Promise.all([
      this.occurrences(organizationId, query),
      this.conflicts(organizationId, query),
      this.repository.organizationSegment(organizationId),
    ]);
    const segment = (
      query.segment ??
      events.find((event) => event.segment)?.segment ??
      organization?.primarySegment ??
      'GENERAL'
    ).toUpperCase();
    const environmental = segment.includes('HVAC') || segment.includes('AGRO');
    return {
      generatedAt: new Date().toISOString(),
      source: 'MOCK',
      horizon: {
        from: query.from.toISOString(),
        to: query.to.toISOString(),
      },
      conflicts,
      routeOptimizations:
        events.length > 1
          ? [
              {
                id: 'route-optimization-1',
                priority: 'MEDIUM',
                affectedEventIds: events
                  .slice(0, 3)
                  .map((event) => event.eventId),
                estimatedDistanceReductionPercent: 14,
                estimatedTimeSavedMinutes: 38,
                recommendation:
                  'Agrupar eventos próximos por unidade e janela de atendimento.',
              },
            ]
          : [],
      delayPredictions: events.slice(0, 2).map((event, index) => ({
        eventId: event.eventId,
        probability: 0.42 + index * 0.13,
        estimatedDelayMinutes: 18 + index * 12,
        factors: ['trânsito histórico', 'carga da equipe', 'duração anterior'],
      })),
      reschedulingRecommendations: conflicts.slice(0, 3).map((conflict) => ({
        eventId: conflict.eventId ?? 'unknown',
        currentStartsAt: conflict.startsAt,
        suggestedStartsAt: new Date(
          Date.parse(conflict.endsAt) + 30 * 60_000,
        ).toISOString(),
        reason: conflict.message,
        confidence: 0.78,
      })),
      weatherImpact: {
        applicable: environmental,
        segment,
        risk: environmental ? 'MEDIUM' : 'LOW',
        summary: environmental
          ? 'Calor e chuva podem alterar duração, deslocamento e produtividade.'
          : 'Impacto climático não é prioritário para o segmento atual.',
        affectedEventIds: environmental
          ? events.slice(0, 3).map((event) => event.eventId)
          : [],
        recommendations: environmental
          ? [
              'Priorizar atividades externas no início do dia.',
              'Reservar margem adicional entre deslocamentos.',
            ]
          : [],
      },
    };
  }

  async dashboardReadModel(
    organizationId: string,
  ): Promise<DashboardSchedulingReadModel> {
    const timezone = await this.repository.agendaTimezone(organizationId);
    const today = civilDateKey(new Date(), timezone);
    const start = localViewRange(
      'DAY',
      new Date(`${today}T00:00:00.000Z`),
      timezone,
    ).from;
    const end = addCivilDays(start, 7, timezone);
    const query = { from: start, to: end };
    const [events, conflicts, organization] = await Promise.all([
      this.occurrences(organizationId, query),
      this.conflicts(organizationId, query),
      this.repository.organizationSegment(organizationId),
    ]);
    const environmental = /HVAC|AGRO/i.test(organization?.primarySegment ?? '');
    return {
      generatedAt: new Date().toISOString(),
      today: {
        total: events.filter(
          (event) => civilDateKey(new Date(event.startsAt), timezone) === today,
        ).length,
        completed: events.filter((event) => event.status === 'COMPLETED')
          .length,
        upcoming: events.filter(
          (event) => Date.parse(event.startsAt) > Date.now(),
        ).length,
        conflicts: conflicts.length,
      },
      nextEvents: events
        .filter((event) => Date.parse(event.endsAt) > Date.now())
        .slice(0, 10),
      intelligence: {
        highRiskDelays: Math.min(2, events.length),
        criticalConflicts: conflicts.filter(
          (conflict) => conflict.severity === 'CRITICAL',
        ).length,
        weatherRisk: environmental ? 'MEDIUM' : 'LOW',
      },
    };
  }

  private expandEvent(
    event: SchedulingEventRecord,
    from: Date,
    to: Date,
  ): SchedulingOccurrenceReadModel[] {
    return this.recurrence
      .expand(
        event.startsAt,
        event.endsAt,
        event.recurrence ? this.rule(event.recurrence) : null,
        from,
        to,
      )
      .map((occurrence) => {
        const responsible = event.allocations.find(
          (allocation) =>
            allocation.role === 'RESPONSIBLE_FIELD_TECHNICIAN' &&
            allocation.userId,
        );
        const auxiliaries = event.allocations.filter(
          (allocation) =>
            allocation.role === 'AUXILIARY_TECHNICIAN' && allocation.userId,
        );
        return {
          occurrenceId: `${event.id}:${occurrence.startsAt.toISOString()}`,
          eventId: event.id,
          calendarId: event.calendarId,
          title: event.title,
          description: event.description,
          type: event.type,
          status: event.status,
          priority: event.priority,
          startsAt: occurrence.startsAt.toISOString(),
          endsAt: occurrence.endsAt.toISOString(),
          allDay: event.allDay,
          timezone: event.timezone,
          businessUnitId: event.businessUnitId,
          customerId: event.customerId,
          assetId: event.assetId,
          segment: event.segment,
          source: {
            module: event.sourceModule,
            entityType: event.sourceEntityType,
            entityId: event.sourceEntityId,
          },
          location: event.location,
          allocations: event.allocations.map((allocation) => ({
            id: allocation.id,
            resourceType: allocation.resourceType,
            userId: allocation.userId,
            assetId: allocation.assetId,
            resourceKey: allocation.resourceKey,
            role: allocation.role,
            status: allocation.status,
          })),
          assignmentAuthority: this.isOperationLinked(event)
            ? ('OPERATION' as const)
            : ('SCHEDULING' as const),
          responsibleFieldTechnician: responsible?.userId
            ? {
                userId: responsible.userId,
                role: 'RESPONSIBLE_FIELD_TECHNICIAN' as const,
              }
            : null,
          auxiliaryTechnicians: auxiliaries.map((allocation) => ({
            userId: allocation.userId!,
            role: 'AUXILIARY_TECHNICIAN' as const,
          })),
          recurring: Boolean(event.recurrence),
        };
      });
  }

  private isOperationLinked(input: {
    sourceModule: string;
    sourceEntityType: string;
    sourceEntityId?: string | null;
  }) {
    return (
      input.sourceModule.toLowerCase() === 'operations' &&
      input.sourceEntityType.toUpperCase() === 'OPERATION' &&
      Boolean(input.sourceEntityId)
    );
  }

  private async authoritativeAllocations(
    organizationId: string,
    input: CreateEventDto,
  ): Promise<ResourceAllocationDto[]> {
    if (this.isOperationLinked(input)) {
      const operation = await this.operations.get(
        input.sourceEntityId!,
        organizationId,
      );
      if (
        input.businessUnitId &&
        input.businessUnitId !== operation.businessUnitId
      )
        throw new ValidationException(
          'Operation-linked event must use the operation business unit',
        );
      return [
        ...(operation.responsibleFieldTechnicianId
          ? [
              {
                resourceType: ResourceType.USER,
                userId: operation.responsibleFieldTechnicianId,
                role: 'RESPONSIBLE_FIELD_TECHNICIAN',
              },
            ]
          : []),
        ...operation.auxiliaryTechnicians.map((assignment) => ({
          resourceType: ResourceType.USER,
          userId: assignment.userId,
          role: 'AUXILIARY_TECHNICIAN',
        })),
      ];
    }
    const allocations = input.allocations ?? [];
    const technicians = allocations.filter((allocation) =>
      ['RESPONSIBLE_FIELD_TECHNICIAN', 'AUXILIARY_TECHNICIAN'].includes(
        allocation.role ?? '',
      ),
    );
    if (!technicians.length) return allocations;
    if (!input.businessUnitId)
      throw new ValidationException(
        'Technician allocations require a business unit',
      );
    if (
      technicians.filter(
        (allocation) => allocation.role === 'RESPONSIBLE_FIELD_TECHNICIAN',
      ).length > 1
    )
      throw new ValidationException(
        'An event can have at most one responsible field technician',
      );
    const ids = technicians
      .map((allocation) => allocation.userId)
      .filter((id): id is string => Boolean(id));
    if (ids.length !== technicians.length || new Set(ids).size !== ids.length)
      throw new ValidationException(
        'Technician allocations require distinct users',
      );
    /**
     * Responsável e auxiliar não passam pelo mesmo portão — como na operação.
     *
     * As alocações daqui saem da própria operação quando o evento nasce de uma
     * (logo acima), então cobrar perfil de técnico de campo do auxiliar
     * transformava um atendimento atribuído corretamente num evento impossível
     * de agendar: a atribuição passava e a agenda recusava, sem que nada na
     * operação tivesse mudado.
     */
    const executante = technicians.find(
      (allocation) => allocation.role === 'RESPONSIBLE_FIELD_TECHNICIAN',
    )?.userId;
    if (executante) {
      const eligible = await this.workforce.listProfessionals(
        organizationId,
        'FIELD_TECHNICIAN',
        input.businessUnitId,
      );
      if (!eligible.some((profile) => profile.userId === executante))
        throw new ValidationException(
          'The scheduled responsible technician must be an active FIELD_TECHNICIAN in the event business unit',
        );
    }

    const acompanhantes = technicians
      .filter((allocation) => allocation.role === 'AUXILIARY_TECHNICIAN')
      .map((allocation) => allocation.userId)
      .filter((id): id is string => Boolean(id));
    if (acompanhantes.length) {
      const candidatos = await this.workforce.listFieldAssistantCandidates(
        organizationId,
        input.businessUnitId,
      );
      const permitidos = new Set(candidatos.map((item) => item.userId));
      if (acompanhantes.some((id) => !permitidos.has(id)))
        throw new ValidationException(
          'Every scheduled auxiliary technician must be an active member with field app access in the event business unit',
        );
    }
    return allocations;
  }

  private conflictsBetween(events: SchedulingOccurrenceReadModel[]) {
    const conflicts: SchedulingConflictReadModel[] = [];
    for (let leftIndex = 0; leftIndex < events.length; leftIndex += 1) {
      const left = events[leftIndex]!;
      if (left.status === 'CANCELLED') continue;
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < events.length;
        rightIndex += 1
      ) {
        const right = events[rightIndex]!;
        if (
          right.status === 'CANCELLED' ||
          Date.parse(left.startsAt) >= Date.parse(right.endsAt) ||
          Date.parse(right.startsAt) >= Date.parse(left.endsAt)
        )
          continue;
        const shared = this.sharedResources(left, right);
        if (shared.length) {
          for (const resource of shared)
            conflicts.push({
              id: `resource:${left.occurrenceId}:${right.occurrenceId}:${resource}`,
              severity: 'CRITICAL',
              type: 'RESOURCE_OVERLAP',
              eventId: left.eventId,
              conflictingEventId: right.eventId,
              resourceType: resource.split(':')[0],
              resourceId: resource.split(':').slice(1).join(':'),
              startsAt:
                Date.parse(left.startsAt) > Date.parse(right.startsAt)
                  ? left.startsAt
                  : right.startsAt,
              endsAt:
                Date.parse(left.endsAt) < Date.parse(right.endsAt)
                  ? left.endsAt
                  : right.endsAt,
              message: 'O mesmo recurso está alocado em eventos sobrepostos.',
            });
        } else if (left.calendarId === right.calendarId) {
          conflicts.push({
            id: `event:${left.occurrenceId}:${right.occurrenceId}`,
            severity: 'WARNING',
            type: 'EVENT_OVERLAP',
            eventId: left.eventId,
            conflictingEventId: right.eventId,
            startsAt: left.startsAt,
            endsAt: left.endsAt,
            message: 'Eventos do mesmo calendário possuem sobreposição.',
          });
        }
      }
    }
    return conflicts;
  }

  private async detectInputConflicts(
    organizationId: string,
    input: CreateEventDto,
    excludeEventId?: string,
  ) {
    const horizon = this.conflictHorizon(input);
    const candidates = await this.repository.candidateEvents(organizationId, {
      from: input.startsAt,
      to: horizon,
      businessUnitId: input.businessUnitId,
    });
    const proposed = this.syntheticEvent(input);
    const events = [
      ...candidates
        .filter((event) => event.id !== excludeEventId)
        .flatMap((event) => this.expandEvent(event, input.startsAt, horizon)),
      ...this.expandEvent(proposed, input.startsAt, horizon),
    ];
    const conflicts = this.conflictsBetween(events).filter(
      (conflict) =>
        conflict.eventId === proposed.id ||
        conflict.conflictingEventId === proposed.id,
    );
    return [
      ...conflicts,
      ...(await this.availabilityConflicts(
        organizationId,
        proposed,
        input.startsAt,
        horizon,
      )),
    ];
  }

  private async availabilityConflicts(
    organizationId: string,
    event: SchedulingEventRecord,
    from: Date,
    to: Date,
  ) {
    const userIds = event.allocations
      .map((allocation) => allocation.userId)
      .filter((value): value is string => Boolean(value));
    const resourceKeys = event.allocations
      .map((allocation) => allocation.assetId ?? allocation.resourceKey)
      .filter((value): value is string => Boolean(value));
    if (!userIds.length && !resourceKeys.length) return [];
    const rules = await this.repository.availabilityForResources(
      organizationId,
      { userIds, resourceKeys },
      from,
      to,
    );
    const occurrences = this.expandEvent(event, from, to);
    const conflicts: SchedulingConflictReadModel[] = [];
    for (const occurrence of occurrences) {
      for (const allocation of event.allocations) {
        const identity =
          allocation.userId ?? allocation.assetId ?? allocation.resourceKey;
        if (!identity) continue;
        const resourceRules = rules.filter(
          (rule) =>
            rule.userId === allocation.userId ||
            rule.resourceKey === allocation.assetId ||
            rule.resourceKey === allocation.resourceKey,
        );
        const matching = resourceRules.filter((rule) =>
          this.ruleApplies(rule, occurrence.startsAt),
        );
        const blocked = matching.find(
          (rule) =>
            rule.kind === 'BLOCKED' &&
            this.minuteOverlap(rule, occurrence.startsAt, occurrence.endsAt),
        );
        if (blocked)
          conflicts.push({
            id: `availability:${occurrence.occurrenceId}:${blocked.id}`,
            severity: 'CRITICAL',
            type: 'BLOCKED_AVAILABILITY',
            eventId: event.id,
            resourceType: allocation.resourceType,
            resourceId: identity,
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            message: blocked.reason ?? 'O recurso possui bloqueio de agenda.',
          });
        const available = matching.filter((rule) => rule.kind === 'AVAILABLE');
        if (
          available.length &&
          !available.some((rule) =>
            this.minuteContains(rule, occurrence.startsAt, occurrence.endsAt),
          )
        )
          conflicts.push({
            id: `outside:${occurrence.occurrenceId}:${identity}`,
            severity: 'WARNING',
            type: 'OUTSIDE_AVAILABILITY',
            eventId: event.id,
            resourceType: allocation.resourceType,
            resourceId: identity,
            startsAt: occurrence.startsAt,
            endsAt: occurrence.endsAt,
            message: 'Evento fora da disponibilidade configurada do recurso.',
          });
      }
    }
    return conflicts;
  }

  private sharedResources(
    left: SchedulingOccurrenceReadModel,
    right: SchedulingOccurrenceReadModel,
  ) {
    const leftResources = new Set(this.occurrenceResources(left));
    return this.occurrenceResources(right).filter((resource) =>
      leftResources.has(resource),
    );
  }

  private occurrenceResources(event: SchedulingOccurrenceReadModel) {
    return [
      ...(event.assetId ? [`ASSET:${event.assetId}`] : []),
      ...event.allocations.flatMap((allocation) => {
        if (allocation.userId) return [`USER:${allocation.userId}`];
        if (allocation.assetId) return [`ASSET:${allocation.assetId}`];
        if (allocation.resourceKey)
          return [`${allocation.resourceType}:${allocation.resourceKey}`];
        return [];
      }),
    ];
  }

  private validateEvent(input: CreateEventDto) {
    if (input.endsAt <= input.startsAt)
      throw new ValidationException('Event end must follow start');
    if (input.endsAt.getTime() - input.startsAt.getTime() > 31 * 86_400_000)
      throw new ValidationException('A single event cannot exceed 31 days');
    this.validateRecurrence(input.recurrence, input.startsAt);
    this.validateAllocations(input.allocations ?? []);
  }

  private validateRecurrence(
    recurrence: RecurrenceDto | undefined,
    startsAt: Date,
  ) {
    if (!recurrence) return;
    if (recurrence.count && recurrence.until)
      throw new ValidationException(
        'Recurrence must use count or until, not both',
      );
    if (recurrence.until && recurrence.until < startsAt)
      throw new ValidationException('Recurrence end precedes event start');
    if (
      recurrence.frequency === RecurrenceFrequency.WEEKLY &&
      recurrence.byWeekday?.length === 0
    )
      throw new ValidationException(
        'Weekly recurrence weekdays cannot be empty',
      );
    if (
      recurrence.frequency === RecurrenceFrequency.CUSTOM &&
      !recurrence.customDates?.length
    )
      throw new ValidationException('Custom recurrence requires dates');
  }

  private validateAllocations(allocations: ResourceAllocationDto[]) {
    const keys = new Set<string>();
    for (const allocation of allocations) {
      const identity =
        allocation.resourceType === ResourceType.USER
          ? allocation.userId
          : allocation.resourceType === ResourceType.ASSET
            ? allocation.assetId
            : allocation.resourceKey;
      if (!identity)
        throw new ValidationException(
          `${allocation.resourceType} allocation requires its resource identifier`,
        );
      if (
        (allocation.resourceType === ResourceType.USER &&
          (allocation.assetId || allocation.resourceKey)) ||
        (allocation.resourceType === ResourceType.ASSET &&
          (allocation.userId || allocation.resourceKey)) ||
        (allocation.resourceType === ResourceType.CUSTOM &&
          (allocation.userId || allocation.assetId))
      )
        throw new ValidationException(
          'Allocation resource fields are inconsistent',
        );
      const key = `${allocation.resourceType}:${identity}`;
      if (keys.has(key))
        throw new ValidationException(`Duplicate resource allocation: ${key}`);
      keys.add(key);
    }
  }

  private validateAvailability(input: CreateAvailabilityDto) {
    if (input.startMinute >= input.endMinute)
      throw new ValidationException('Availability time range is invalid');
    if (input.date === undefined && input.dayOfWeek === undefined)
      throw new ValidationException(
        'Availability requires date or day of week',
      );
    if (input.date && input.dayOfWeek !== undefined)
      throw new ValidationException('Use either date or day of week');
    if (
      input.effectiveFrom &&
      input.effectiveUntil &&
      input.effectiveUntil < input.effectiveFrom
    )
      throw new ValidationException('Availability effective range is invalid');
    if (
      input.resourceType === ResourceType.USER &&
      (!input.userId || input.resourceKey)
    )
      throw new ValidationException('USER availability requires only userId');
    if (
      input.resourceType !== ResourceType.USER &&
      (!input.resourceKey || input.userId)
    )
      throw new ValidationException(
        `${input.resourceType} availability requires only resourceKey`,
      );
  }

  private validateRange(from: Date, to: Date) {
    if (to <= from) throw new ValidationException('Schedule range is invalid');
    if (to.getTime() - from.getTime() > 366 * 86_400_000)
      throw new ValidationException('Schedule range cannot exceed 366 days');
  }

  private async validateReferences(
    organizationId: string,
    input: {
      businessUnitId?: string;
      customerId?: string;
      assetId?: string;
      userIds: string[];
      allocationAssetIds: string[];
    },
  ) {
    const references = await this.repository.references(organizationId, input);
    if (input.businessUnitId && !references.businessUnit)
      throw new ValidationException('Invalid business unit');
    if (input.customerId && !references.customer)
      throw new ValidationException('Invalid customer');
    if (input.assetId && !references.asset)
      throw new ValidationException('Invalid asset');
    if (
      references.asset &&
      input.businessUnitId &&
      references.asset.businessUnitId !== input.businessUnitId
    )
      throw new ValidationException('Asset does not belong to business unit');
    if (
      references.asset?.customerId &&
      input.customerId &&
      references.asset.customerId !== input.customerId
    )
      throw new ValidationException('Asset does not belong to customer');
    if (references.users.length !== new Set(input.userIds).size)
      throw new ValidationException('One or more users are not active members');
    if (
      references.allocationAssets.length !==
      new Set(input.allocationAssetIds).size
    )
      throw new ValidationException(
        'One or more allocation assets are invalid',
      );
  }

  private referenceInput(input: CreateEventDto) {
    return {
      businessUnitId: input.businessUnitId,
      customerId: input.customerId,
      assetId: input.assetId,
      userIds: (input.allocations ?? [])
        .map((allocation) => allocation.userId)
        .filter((value): value is string => Boolean(value)),
      allocationAssetIds: (input.allocations ?? [])
        .map((allocation) => allocation.assetId)
        .filter((value): value is string => Boolean(value)),
    };
  }

  private recurrenceData(
    recurrence: RecurrenceDto | undefined,
  ): Prisma.SchedulingRecurrenceUncheckedCreateWithoutEventInput | undefined {
    if (!recurrence) return undefined;
    return {
      frequency: recurrence.frequency,
      interval: recurrence.interval ?? 1,
      byWeekday: [...new Set(recurrence.byWeekday ?? [])],
      byMonthDay: recurrence.byMonthDay,
      count: recurrence.count,
      until: recurrence.until,
      customRule: recurrence.customDates
        ? {
            dates: recurrence.customDates.map((date) => date.toISOString()),
          }
        : undefined,
      exceptions: recurrence.exceptions ?? [],
      timezone: recurrence.timezone,
    };
  }

  private allocationData(
    allocations: ResourceAllocationDto[],
  ): Prisma.SchedulingResourceAllocationUncheckedCreateWithoutEventInput[] {
    return allocations.map((allocation) => ({
      resourceType: allocation.resourceType,
      userId: allocation.userId,
      assetId: allocation.assetId,
      resourceKey: allocation.resourceKey?.trim(),
      role: allocation.role?.trim(),
    }));
  }

  private mergeEvent(
    current: SchedulingEventRecord,
    input: UpdateEventDto,
  ): CreateEventDto {
    return {
      calendarId: input.calendarId ?? current.calendarId,
      businessUnitId:
        input.businessUnitId ?? current.businessUnitId ?? undefined,
      customerId: input.customerId ?? current.customerId ?? undefined,
      assetId: input.assetId ?? current.assetId ?? undefined,
      title: input.title ?? current.title,
      description: input.description ?? current.description ?? undefined,
      type: input.type ?? current.type,
      status: input.status ?? current.status,
      priority: input.priority ?? current.priority,
      startsAt: input.startsAt ?? current.startsAt,
      endsAt: input.endsAt ?? current.endsAt,
      allDay: input.allDay ?? current.allDay,
      timezone: input.timezone ?? current.timezone,
      segment: input.segment ?? current.segment ?? undefined,
      sourceModule: input.sourceModule ?? current.sourceModule,
      sourceEntityType: input.sourceEntityType ?? current.sourceEntityType,
      sourceEntityId:
        input.sourceEntityId ?? current.sourceEntityId ?? undefined,
      location:
        input.location ??
        (current.location as Record<string, unknown> | undefined),
      metadata:
        input.metadata ??
        (current.metadata as Record<string, unknown> | undefined),
      recurrence: input.clearRecurrence
        ? undefined
        : (input.recurrence ??
          (current.recurrence
            ? {
                frequency: current.recurrence.frequency,
                interval: current.recurrence.interval,
                byWeekday: current.recurrence.byWeekday,
                byMonthDay: current.recurrence.byMonthDay ?? undefined,
                count: current.recurrence.count ?? undefined,
                until: current.recurrence.until ?? undefined,
                customDates: this.customDates(current.recurrence.customRule),
                exceptions: current.recurrence.exceptions,
                timezone: current.recurrence.timezone,
              }
            : undefined)),
      allocations:
        input.allocations ??
        current.allocations.map((allocation) => ({
          resourceType: allocation.resourceType,
          userId: allocation.userId ?? undefined,
          assetId: allocation.assetId ?? undefined,
          resourceKey: allocation.resourceKey ?? undefined,
          role: allocation.role ?? undefined,
        })),
      allowConflicts: input.allowConflicts,
    };
  }

  private syntheticEvent(input: CreateEventDto): SchedulingEventRecord {
    const id = '__proposed__';
    return {
      id,
      organizationId: '',
      businessUnitId: input.businessUnitId ?? null,
      calendarId: input.calendarId,
      customerId: input.customerId ?? null,
      assetId: input.assetId ?? null,
      createdById: '',
      title: input.title,
      description: input.description ?? null,
      type: input.type,
      status: input.status ?? 'CONFIRMED',
      priority: input.priority ?? 'NORMAL',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      allDay: input.allDay ?? false,
      timezone: input.timezone,
      segment: input.segment ?? null,
      sourceModule: input.sourceModule,
      sourceEntityType: input.sourceEntityType,
      sourceEntityId: input.sourceEntityId ?? null,
      location: (input.location ?? null) as Prisma.JsonValue,
      metadata: (input.metadata ?? null) as Prisma.JsonValue,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      recurrence: input.recurrence
        ? {
            id: '',
            eventId: id,
            frequency: input.recurrence.frequency,
            interval: input.recurrence.interval ?? 1,
            byWeekday: [...new Set(input.recurrence.byWeekday ?? [])],
            exceptions: input.recurrence.exceptions ?? [],
            timezone: input.recurrence.timezone,
            byMonthDay: input.recurrence.byMonthDay ?? null,
            count: input.recurrence.count ?? null,
            until: input.recurrence.until ?? null,
            customRule: input.recurrence.customDates
              ? {
                  dates: input.recurrence.customDates.map((date) =>
                    date.toISOString(),
                  ),
                }
              : null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }
        : null,
      allocations: this.allocationData(input.allocations ?? []).map(
        (allocation, index) => ({
          id: `proposed-allocation-${index}`,
          eventId: id,
          userId: allocation.userId ?? null,
          assetId: allocation.assetId ?? null,
          resourceType: allocation.resourceType,
          resourceKey: allocation.resourceKey ?? null,
          role: allocation.role ?? null,
          status: 'ALLOCATED',
          createdAt: new Date(),
          deletedAt: null,
          user: null,
          asset: null,
        }),
      ),
      calendar: {
        id: input.calendarId,
        key: '',
        name: '',
        color: null,
        timezone: input.timezone,
      },
      customer: null,
      asset: null,
      createdBy: { id: '', displayName: '' },
    };
  }

  private rule(value: {
    frequency: string;
    interval: number;
    byWeekday: number[];
    byMonthDay: number | null;
    count: number | null;
    until: Date | null;
    customRule: Prisma.JsonValue | null;
    exceptions: Date[];
    timezone: string;
  }): RecurrenceRule {
    return value;
  }

  private conflictHorizon(input: CreateEventDto) {
    const maximum = addCivilDays(input.startsAt, 90, input.timezone);
    if (input.recurrence?.until && input.recurrence.until < maximum)
      return new Date(input.recurrence.until.getTime() + 1);
    return maximum;
  }

  private ruleApplies(
    rule: {
      dayOfWeek: number | null;
      date: Date | null;
      effectiveFrom: Date | null;
      effectiveUntil: Date | null;
      timezone: string;
    },
    startsAtIso: string,
  ) {
    return availabilityRuleApplies(rule, new Date(startsAtIso));
  }

  private minuteOverlap(
    rule: { startMinute: number; endMinute: number; timezone: string },
    startsAtIso: string,
    endsAtIso: string,
  ) {
    const startMinute = civilMinute(new Date(startsAtIso), rule.timezone);
    const endMinute = civilMinute(new Date(endsAtIso), rule.timezone);
    return startMinute < rule.endMinute && endMinute > rule.startMinute;
  }

  private minuteContains(
    rule: { startMinute: number; endMinute: number; timezone: string },
    startsAtIso: string,
    endsAtIso: string,
  ) {
    const startMinute = civilMinute(new Date(startsAtIso), rule.timezone);
    const endMinute = civilMinute(new Date(endsAtIso), rule.timezone);
    return startMinute >= rule.startMinute && endMinute <= rule.endMinute;
  }

  private customDates(value: Prisma.JsonValue | null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const dates = value.dates;
    if (!Array.isArray(dates)) return [];
    return dates
      .filter((date): date is string => typeof date === 'string')
      .map((date) => new Date(date))
      .filter((date) => !Number.isNaN(date.getTime()));
  }

  private assertConflicts(
    conflicts: SchedulingConflictReadModel[],
    allowConflicts?: boolean,
  ) {
    const critical = conflicts.filter(
      (conflict) => conflict.severity === 'CRITICAL',
    );
    if (critical.length && !allowConflicts)
      throw new ConflictException(
        `Scheduling conflict detected: ${critical[0]!.message}`,
      );
  }

  private mapConflict(error: unknown, message: string): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    )
      throw new ConflictException(message);
    throw error;
  }
}
