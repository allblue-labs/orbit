import { checklistDefaults } from '../operations/checklist-defaults';
import { assignmentAuthorizationRequired } from '../operations/recurring-authorization';
import { Injectable, Optional } from '@nestjs/common';
import { FieldAssignmentOutbox } from '../notifications/field-assignment-outbox';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RlsTransaction } from '../../database';
import { ForbiddenException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import type { OccurrenceCandidate } from './rvt.domain';

import type { PrismaTransactionClient } from '../../database/prisma.types';
import type {
  AddRvtEvidenceDto,
  CaptureCustomerAcknowledgementDto,
  RegisterRvtEquipmentDto,
  RvtConfigurationQueryDto,
  RvtOccurrenceQueryDto,
  RvtTimelineQueryDto,
  UpdateRvtConfigurationDto,
  UpdateRvtExecutionDto,
} from './rvt.dto';
import {
  equipmentSnapshotSelect,
  executionView,
  maintenanceTypeView,
  type CreateAdHocRvtCommand,
  type CreateRvtConfigurationCommand,
  type ManageRvtOccurrenceCommand,
  type RvtExecutionSource,
  type ScopedRvtQuery,
} from './rvt.persistence';
import { readRvtConfigurations } from './rvt-configuration.query';
import { jsonObject, rvtJson } from './rvt-json';
import {
  resolveRvtCalendar,
  projectRvtOccurrence,
} from './rvt-scheduling.persistence';
import {
  rvtReportSnapshot,
  rvtReportExecutionView,
} from './rvt-report.snapshot';

@Injectable()
export class RvtRepository {
  constructor(
    private readonly rls: RlsTransaction,
    @Optional() private readonly assignmentPush?: FieldAssignmentOutbox,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Tipos de manutenção                                               */
  /* ---------------------------------------------------------------- */

  /** Os tipos da organização, com o roteiro de cada um. */
  listMaintenanceTypes(organizationId: string, onlyActive = true) {
    return this.rls.run((tx) =>
      tx.rvtMaintenanceType.findMany({
        where: {
          organizationId,
          deletedAt: null,
          ...(onlyActive ? { isActive: true } : {}),
        },
        orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
        include: maintenanceTypeView,
      }),
    );
  }

  findMaintenanceType(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.rvtMaintenanceType.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: maintenanceTypeView,
      }),
    );
  }

  createMaintenanceType(data: {
    organizationId: string;
    key: string;
    label: string;
    intervalDays?: number;
    intervalMonths?: number;
    checklistTemplateId?: string;
    sortOrder?: number;
  }) {
    return this.rls.run((tx) =>
      tx.rvtMaintenanceType.create({
        data: { id: generateUuidV7(), ...data },
        include: maintenanceTypeView,
      }),
    );
  }

  updateMaintenanceType(
    id: string,
    data: {
      label?: string;
      intervalDays?: number | null;
      intervalMonths?: number | null;
      checklistTemplateId?: string | null;
      sortOrder?: number;
      isActive?: boolean;
    },
  ) {
    return this.rls.run((tx) =>
      tx.rvtMaintenanceType.update({
        where: { id },
        data,
        include: maintenanceTypeView,
      }),
    );
  }

  /**
   * Remoção é lógica.
   *
   * Contratos de RVT apontam para o tipo, e um relatório de visita passada
   * precisa continuar dizendo qual manutenção foi feita.
   */
  softDeleteMaintenanceType(id: string) {
    return this.rls.run((tx) =>
      tx.rvtMaintenanceType.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      }),
    );
  }

  /** Quantos contratos ativos dependem deste tipo. */
  countConfigurationsByMaintenanceType(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.rvtConfiguration.count({
        where: { maintenanceTypeId: id, organizationId, deletedAt: null },
      }),
    );
  }

  /** O modelo de checklist, restrito à organização — a FK não a conhece. */
  findChecklistTemplate(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.checklistTemplate.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      }),
    );
  }

  createConfiguration(
    input: CreateRvtConfigurationCommand,
    occurrences: OccurrenceCandidate[],
    actorId: string,
  ) {
    return this.rls.run(async (tx) => {
      await this.assertScope(
        tx,
        input.organizationId,
        input.businessUnitId,
        input.customerId,
        input.equipmentIds ?? [],
      );
      if (input.defaultResponsibleFieldTechnicianId)
        await this.assertProfessional(
          tx,
          input.organizationId,
          input.businessUnitId,
          input.defaultResponsibleFieldTechnicianId,
          'FIELD_TECHNICIAN',
        );
      if (input.technicalResponsibleUserId)
        await this.assertProfessional(
          tx,
          input.organizationId,
          input.businessUnitId,
          input.technicalResponsibleUserId,
          'TECHNICAL_RESPONSIBLE',
        );
      const configuration = await tx.rvtConfiguration.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId: input.customerId,
          code: input.code,
          name: input.name,
          maintenanceTypeId: input.maintenanceTypeId,
          scheduleMode: input.scheduleMode,
          calendarId: input.calendarId,
          startTime: input.startTime,
          coverageStart: this.date(input.coverageStart),
          coverageEnd: input.coverageEnd ? this.date(input.coverageEnd) : null,
          timezone: input.timezone,
          serviceLocation: rvtJson(input.serviceLocation),
          recurrence: input.recurrence
            ? rvtJson(input.recurrence)
            : Prisma.JsonNull,
          procedure: rvtJson(input.procedure),
          technicalResponsibleUserId: input.technicalResponsibleUserId ?? null,
          defaultResponsibleFieldTechnicianId:
            input.defaultResponsibleFieldTechnicianId ?? null,
          requiresTechnicalResponsible:
            input.requiresTechnicalResponsible ?? false,
          metadata: rvtJson(input.metadata ?? {}),
          createdById: actorId,
          equipment: {
            create: (input.equipmentIds ?? []).map((assetId: string) => ({
              organizationId: input.organizationId,
              assetId,
            })),
          },
        },
      });
      const calendar = await resolveRvtCalendar(
        tx,
        input.organizationId,
        input.businessUnitId,
        input.timezone,
        input.calendarId,
      );
      for (const item of occurrences) {
        const occurrence = await tx.rvtOccurrence.create({
          data: {
            organizationId: input.organizationId,
            businessUnitId: input.businessUnitId,
            configurationId: configuration.id,
            sequenceNumber: item.sequenceNumber,
            scheduledFor: item.scheduledFor,
            localScheduledDate: this.date(item.localDate),
            originalScheduledDate: this.date(item.localDate),
            equipmentIds: input.equipmentIds ?? [],
            responsibleFieldTechnicianId:
              input.defaultResponsibleFieldTechnicianId ?? null,
          },
        });
        const schedulingEventId = await projectRvtOccurrence(tx, {
          occurrenceId: occurrence.id,
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId: input.customerId,
          actorId,
          calendarId: calendar.id,
          title: `${input.name} — visita ${String(item.sequenceNumber).padStart(3, '0')}`,
          startsAt: item.scheduledFor,
          timezone: input.timezone,
          location: input.serviceLocation,
          responsibleUserId: input.defaultResponsibleFieldTechnicianId ?? null,
        });
        await tx.rvtOccurrence.update({
          where: { id: occurrence.id },
          data: { schedulingEventId },
        });
        await this.assignmentPush?.rvt(tx, occurrence.id);
      }
      await this.audit(
        tx,
        input.organizationId,
        input.businessUnitId,
        actorId,
        'RVT_CONFIGURATION_CREATED',
        configuration.id,
        { occurrenceCount: occurrences.length },
      );
      return configuration.id;
    });
  }

  listConfigurations(
    organizationId: string,
    query: ScopedRvtQuery<RvtConfigurationQueryDto>,
  ) {
    return this.rls.run(async (tx) => {
      const rows = await tx.rvtConfiguration.findMany({
        where: {
          organizationId,
          deletedAt: null,
          businessUnitId: query.businessUnitId ?? {
            in: [...query.businessUnitIds],
          },
          customerId: query.customerId,
          status: query.status,
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit ?? 50,
        select: { id: true },
      });
      return readRvtConfigurations(
        tx,
        organizationId,
        rows.map(({ id }) => id),
      );
    });
  }

  updateConfiguration(
    id: string,
    organizationId: string,
    actorId: string,
    input: UpdateRvtConfigurationDto,
    candidates: OccurrenceCandidate[],
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:configuration:${id}`}))`;
      const current = await tx.rvtConfiguration.findFirstOrThrow({
        where: { id, organizationId, deletedAt: null },
      });
      if (input.defaultResponsibleFieldTechnicianId)
        await this.assertProfessional(
          tx,
          organizationId,
          current.businessUnitId,
          input.defaultResponsibleFieldTechnicianId,
          'FIELD_TECHNICIAN',
        );
      if (input.technicalResponsibleUserId)
        await this.assertProfessional(
          tx,
          organizationId,
          current.businessUnitId,
          input.technicalResponsibleUserId,
          'TECHNICAL_RESPONSIBLE',
        );
      const effective = {
        name: input.name ?? current.name,
        maintenanceTypeId: input.maintenanceTypeId ?? current.maintenanceTypeId,
        coverageStart:
          input.coverageStart ??
          current.coverageStart.toISOString().slice(0, 10),
        coverageEnd:
          input.coverageEnd ?? current.coverageEnd?.toISOString().slice(0, 10),
        timezone: input.timezone ?? current.timezone,
        serviceLocation: input.serviceLocation ?? current.serviceLocation,
        responsible:
          input.defaultResponsibleFieldTechnicianId !== undefined
            ? input.defaultResponsibleFieldTechnicianId
            : current.defaultResponsibleFieldTechnicianId,
      };
      await tx.rvtConfiguration.update({
        where: { id },
        data: {
          name: input.name,
          calendarId: input.calendarId,
          startTime: input.startTime,
          maintenanceTypeId: input.maintenanceTypeId,
          coverageStart: input.coverageStart
            ? this.date(input.coverageStart)
            : undefined,
          coverageEnd:
            input.coverageEnd === null
              ? null
              : input.coverageEnd
                ? this.date(input.coverageEnd)
                : undefined,
          timezone: input.timezone,
          serviceLocation: input.serviceLocation
            ? rvtJson(input.serviceLocation)
            : undefined,
          recurrence: input.recurrence ? rvtJson(input.recurrence) : undefined,
          procedure: input.procedure ? rvtJson(input.procedure) : undefined,
          technicalResponsibleUserId: input.technicalResponsibleUserId,
          defaultResponsibleFieldTechnicianId:
            input.defaultResponsibleFieldTechnicianId,
          requiresTechnicalResponsible: input.requiresTechnicalResponsible,
          metadata: input.metadata ? rvtJson(input.metadata) : undefined,
        },
      });
      if (input.equipmentIds) {
        await this.assertScope(
          tx,
          organizationId,
          current.businessUnitId,
          current.customerId,
          input.equipmentIds,
        );
        await tx.rvtConfigurationEquipment.updateMany({
          where: {
            configurationId: id,
            removedAt: null,
            assetId: { notIn: input.equipmentIds },
          },
          data: { removedAt: new Date() },
        });
        for (const assetId of input.equipmentIds) {
          await tx.rvtConfigurationEquipment.upsert({
            where: {
              configurationId_assetId: { configurationId: id, assetId },
            },
            create: { organizationId, configurationId: id, assetId },
            update: { removedAt: null },
          });
        }
      }
      const now = new Date();
      const untouched = await tx.rvtOccurrence.findMany({
        where: {
          configurationId: id,
          status: 'SCHEDULED',
          scheduledFor: { gt: now },
          execution: null,
          customized: false,
          deletedAt: null,
        },
        orderBy: { sequenceNumber: 'asc' },
      });
      const desired = candidates.filter((item) => item.scheduledFor > now);
      const desiredByDate = new Map(
        desired.map((item) => [item.localDate, item]),
      );
      const untouchedIds = new Set(untouched.map((item) => item.id));
      const immutableDates = await tx.rvtOccurrence.findMany({
        where: { configurationId: id, id: { notIn: [...untouchedIds] } },
        select: { localScheduledDate: true, originalScheduledDate: true },
      });
      for (const item of immutableDates) {
        if (item.originalScheduledDate)
          desiredByDate.delete(
            item.originalScheduledDate.toISOString().slice(0, 10),
          );
        if (item.localScheduledDate)
          desiredByDate.delete(
            item.localScheduledDate.toISOString().slice(0, 10),
          );
      }
      const calendar = await resolveRvtCalendar(
        tx,
        organizationId,
        current.businessUnitId,
        effective.timezone,
        input.calendarId !== undefined ? input.calendarId : current.calendarId,
      );
      let created = 0;
      let cancelled = 0;
      let rescheduled = 0;
      for (const occurrence of untouched) {
        const oldDate = occurrence.localScheduledDate
          ?.toISOString()
          .slice(0, 10);
        const target = oldDate ? desiredByDate.get(oldDate) : undefined;
        if (!target) {
          await tx.rvtOccurrence.update({
            where: { id: occurrence.id },
            data: { status: 'CANCELLED' },
          });
          if (occurrence.schedulingEventId)
            await tx.schedulingEvent.update({
              where: { id: occurrence.schedulingEventId },
              data: { status: 'CANCELLED' },
            });
          cancelled++;
          continue;
        }
        desiredByDate.delete(target.localDate);
        if (
          occurrence.scheduledFor?.getTime() !== target.scheduledFor.getTime()
        )
          rescheduled++;
        const schedulingEventId = await projectRvtOccurrence(tx, {
          existingId: occurrence.schedulingEventId,
          occurrenceId: occurrence.id,
          organizationId,
          businessUnitId: current.businessUnitId,
          customerId: current.customerId,
          actorId,
          calendarId: calendar.id,
          title: `${effective.name} — visita ${String(occurrence.sequenceNumber).padStart(3, '0')}`,
          startsAt: target.scheduledFor,
          timezone: effective.timezone,
          location: effective.serviceLocation,
          responsibleUserId: effective.responsible,
        });
        await tx.rvtOccurrence.update({
          where: { id: occurrence.id },
          data: {
            scheduledFor: target.scheduledFor,
            localScheduledDate: this.date(target.localDate),
            schedulingEventId,
            equipmentIds: input.equipmentIds,
            authorizedAt: null,
            authorizedById: null,
            responsibleFieldTechnicianId: effective.responsible,
          },
        });
      }
      if (this.assignmentPush) {
        const assignedVisits = await tx.rvtOccurrence.findMany({
          where: { configurationId: id, deletedAt: null, status: 'SCHEDULED' },
          select: { id: true },
        });
        for (const visit of assignedVisits)
          await this.assignmentPush.rvt(tx, visit.id);
      }
      const maximum = await tx.rvtOccurrence.aggregate({
        where: { configurationId: id },
        _max: { sequenceNumber: true },
      });
      let nextSequence = (maximum._max.sequenceNumber ?? 0) + 1;
      for (const target of desiredByDate.values()) {
        const occurrence = await tx.rvtOccurrence.create({
          data: {
            organizationId,
            businessUnitId: current.businessUnitId,
            configurationId: id,
            sequenceNumber: nextSequence++,
            scheduledFor: target.scheduledFor,
            localScheduledDate: this.date(target.localDate),
            originalScheduledDate: this.date(target.localDate),
            equipmentIds:
              input.equipmentIds ??
              (
                await tx.rvtConfigurationEquipment.findMany({
                  where: { configurationId: id, removedAt: null },
                  select: { assetId: true },
                })
              ).map((x) => x.assetId),
            responsibleFieldTechnicianId: effective.responsible,
          },
        });
        const schedulingEventId = await projectRvtOccurrence(tx, {
          occurrenceId: occurrence.id,
          organizationId,
          businessUnitId: current.businessUnitId,
          customerId: current.customerId,
          actorId,
          calendarId: calendar.id,
          title: `${effective.name} — visita ${String(occurrence.sequenceNumber).padStart(3, '0')}`,
          startsAt: target.scheduledFor,
          timezone: effective.timezone,
          location: effective.serviceLocation,
          responsibleUserId: effective.responsible,
        });
        await tx.rvtOccurrence.update({
          where: { id: occurrence.id },
          data: { schedulingEventId },
        });
        await this.assignmentPush?.rvt(tx, occurrence.id);
        created++;
      }
      if (created || cancelled || rescheduled)
        await this.audit(
          tx,
          organizationId,
          current.businessUnitId,
          actorId,
          'RVT_OCCURRENCES_RECONCILED',
          id,
          { created, cancelled, rescheduled },
        );
      return { created, cancelled, rescheduled };
    });
  }

  configuration(id: string, organizationId: string) {
    return this.rls.run(
      async (tx) =>
        (await readRvtConfigurations(tx, organizationId, [id]))[0] ?? null,
    );
  }

  occurrence(id: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const occurrence = await tx.rvtOccurrence.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: { execution: { select: { id: true } }, configuration: true },
      });
      return occurrence
        ? {
            ...occurrence,
            assignmentAuthorizationRequired:
              await assignmentAuthorizationRequired(tx, organizationId),
          }
        : null;
    });
  }

  listOccurrences(
    organizationId: string,
    query: ScopedRvtQuery<RvtOccurrenceQueryDto>,
  ) {
    return this.rls.run((tx) =>
      tx.rvtOccurrence.findMany({
        where: {
          organizationId,
          businessUnitId: query.businessUnitId ?? {
            in: [...query.businessUnitIds],
          },
          status: query.status,
          deletedAt: null,
          ...(query.assignedToUserId
            ? {
                responsibleFieldTechnicianId: query.assignedToUserId,
              }
            : {}),
        },
        include: {
          execution: { select: { id: true } },
          configuration: { select: { timezone: true } },
        },
        orderBy: [{ scheduledFor: 'asc' }, { sequenceNumber: 'asc' }],
        take: query.limit ?? 100,
      }),
    );
  }

  timeline(
    configurationId: string,
    organizationId: string,
    query: RvtTimelineQueryDto,
  ) {
    return this.rls.run(async (tx) => {
      const configuration = await tx.rvtConfiguration.findFirstOrThrow({
        where: { id: configurationId, organizationId, deletedAt: null },
      });
      const rows = await tx.rvtExecution.findMany({
        where: {
          organizationId,
          businessUnitId: configuration.businessUnitId,
          status: 'COMPLETED',
          occurrence: {
            configuration: { customerId: configuration.customerId },
          },
        },
        orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        take: (query.limit ?? 20) + 1,
        include: {
          occurrence: {
            select: {
              sequenceNumber: true,
              configuration: { select: { name: true } },
            },
          },
        },
      });
      const hasNextPage = rows.length > (query.limit ?? 20);
      const data = rows.slice(0, query.limit ?? 20);
      const users = await tx.user.findMany({
        where: { id: { in: data.map((x) => x.responsibleFieldTechnicianId) } },
        select: { id: true, displayName: true },
      });
      return {
        data: data.map((x) => ({
          ...x,
          user: users.find((u) => u.id === x.responsibleFieldTechnicianId),
        })),
        hasNextPage,
        nextCursor: hasNextPage ? (data.at(-1)?.id ?? null) : null,
      };
    });
  }

  canExecute(organizationId: string, userId: string, businessUnitId: string) {
    return this.rls.run(async (tx) => {
      try {
        await this.assertProfessional(
          tx,
          organizationId,
          businessUnitId,
          userId,
          'FIELD_TECHNICIAN',
        );
        return true;
      } catch (error) {
        if (
          error instanceof Error &&
          [
            'FIELD_TECHNICIAN_NOT_ELIGIBLE',
            'BUSINESS_UNIT_SCOPE_INVALID',
          ].includes(error.message)
        )
          return false;
        throw error;
      }
    });
  }

  manageOccurrence(
    configurationId: string,
    organizationId: string,
    actorId: string,
    input: ManageRvtOccurrenceCommand,
    occurrenceId?: string,
    remove = false,
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:configuration:${configurationId}`}))`;
      const configuration = await tx.rvtConfiguration.findFirstOrThrow({
        where: { id: configurationId, organizationId, deletedAt: null },
      });
      const current = occurrenceId
        ? await tx.rvtOccurrence.findFirstOrThrow({
            where: {
              id: occurrenceId,
              configurationId,
              organizationId,
              deletedAt: null,
            },
            include: { execution: true },
          })
        : null;
      if (
        current?.execution ||
        (current && !['SCHEDULED', 'CANCELLED'].includes(current.status))
      )
        throw new Error('RVT_VISIT_ALREADY_STARTED');
      const equipmentIds: string[] =
        input.equipmentIds ??
        current?.equipmentIds ??
        (
          await tx.rvtConfigurationEquipment.findMany({
            where: { configurationId, removedAt: null },
            select: { assetId: true },
          })
        ).map((x) => x.assetId);
      if (!remove && input.status !== 'CANCELLED' && !equipmentIds.length)
        throw new Error('RVT_VISIT_EQUIPMENT_REQUIRED');
      if (!remove && input.status !== 'CANCELLED')
        await this.assertScope(
          tx,
          organizationId,
          configuration.businessUnitId,
          configuration.customerId,
          equipmentIds,
        );
      const configuredIds = await tx.rvtConfigurationEquipment.findMany({
        where: { configurationId, removedAt: null },
        select: { assetId: true },
      });
      if (
        !remove &&
        input.status !== 'CANCELLED' &&
        equipmentIds.some((id) => !configuredIds.some((x) => x.assetId === id))
      )
        throw new Error('RVT_VISIT_EQUIPMENT_OUTSIDE_CONFIGURATION');
      const responsibleId =
        input.responsibleFieldTechnicianId !== undefined
          ? input.responsibleFieldTechnicianId
          : current
            ? current.responsibleFieldTechnicianId
            : configuration.defaultResponsibleFieldTechnicianId;
      if (responsibleId && !remove && input.status !== 'CANCELLED')
        await this.assertProfessional(
          tx,
          organizationId,
          configuration.businessUnitId,
          responsibleId,
          'FIELD_TECHNICIAN',
        );
      const maximum = await tx.rvtOccurrence.aggregate({
        where: { configurationId },
        _max: { sequenceNumber: true },
      });
      const sequenceNumber =
        current?.sequenceNumber ?? (maximum._max.sequenceNumber ?? 0) + 1;
      const localDate = input.scheduledDate
        ? this.date(input.scheduledDate)
        : undefined;
      if (!current && (!localDate || !input.scheduledFor))
        throw new Error('RVT_VISIT_DATE_REQUIRED');
      const visit = current
        ? await tx.rvtOccurrence.update({
            where: { id: current.id },
            data: {
              scheduledFor: input.scheduledFor,
              originalScheduledDate:
                current.originalScheduledDate ?? current.localScheduledDate,
              localScheduledDate: remove
                ? null
                : input.scheduledDate
                  ? this.date(input.scheduledDate)
                  : undefined,
              equipmentIds,
              responsibleFieldTechnicianId: responsibleId,
              status: remove ? 'CANCELLED' : input.status,
              customized: true,
              deletedAt: remove ? new Date() : null,
              authorizedAt: null,
              authorizedById: null,
            },
          })
        : await tx.rvtOccurrence.create({
            data: {
              organizationId,
              businessUnitId: configuration.businessUnitId,
              configurationId,
              sequenceNumber,
              scheduledFor: input.scheduledFor,
              localScheduledDate: localDate,
              originalScheduledDate: localDate,
              status: input.status ?? 'SCHEDULED',
              equipmentIds,
              responsibleFieldTechnicianId: responsibleId,
              customized: true,
            },
          });
      if (visit.status === 'CANCELLED') {
        if (visit.schedulingEventId)
          await tx.schedulingEvent.update({
            where: { id: visit.schedulingEventId },
            data: {
              status: 'CANCELLED',
              ...(remove ? { deletedAt: new Date() } : {}),
            },
          });
      } else {
        if (!visit.scheduledFor) throw new Error('RVT_VISIT_DATE_REQUIRED');
        const calendar = await resolveRvtCalendar(
          tx,
          organizationId,
          configuration.businessUnitId,
          configuration.timezone,
          configuration.calendarId,
        );
        const schedulingEventId = await projectRvtOccurrence(tx, {
          existingId: visit.schedulingEventId,
          occurrenceId: visit.id,
          organizationId,
          businessUnitId: configuration.businessUnitId,
          customerId: configuration.customerId,
          actorId,
          calendarId: calendar.id,
          title: `${configuration.name} — visita ${String(sequenceNumber).padStart(3, '0')}`,
          startsAt: visit.scheduledFor,
          timezone: configuration.timezone,
          location: configuration.serviceLocation,
          responsibleUserId: responsibleId,
        });
        await tx.rvtOccurrence.update({
          where: { id: visit.id },
          data: { schedulingEventId },
        });
      }
      await this.audit(
        tx,
        organizationId,
        configuration.businessUnitId,
        actorId,
        remove
          ? 'RVT_VISIT_REMOVED'
          : current
            ? 'RVT_VISIT_UPDATED'
            : 'RVT_VISIT_CREATED',
        visit.id,
        { configurationId },
      );
      await this.assignmentPush?.rvt(tx, visit.id);
      return visit.id;
    });
  }

  startExecution(input: {
    organizationId: string;
    occurrenceId: string;
    actorId: string;
    responsibleId: string;
    auxiliaries: string[];
    authorizationBypass?: boolean;
  }) {
    return this.rls.run(async (tx) => {
      const target = await tx.rvtOccurrence.findFirstOrThrow({
        where: {
          id: input.occurrenceId,
          organizationId: input.organizationId,
          deletedAt: null,
        },
        select: { configurationId: true },
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:configuration:${target.configurationId}`}))`;
      await tx.$executeRaw`SELECT id FROM rvt_occurrences WHERE id=${input.occurrenceId}::uuid AND organization_id=${input.organizationId}::uuid FOR UPDATE`;
      const occurrence = await tx.rvtOccurrence.findFirstOrThrow({
        where: {
          id: input.occurrenceId,
          organizationId: input.organizationId,
          deletedAt: null,
        },
        include: {
          configuration: {
            include: {
              equipment: { where: { removedAt: null } },
              /**
               * O tipo traz o roteiro que o técnico vai preencher.
               *
               * Carregado aqui porque o checklist da visita nasce junto com a
               * execução, na mesma transação — começar a visita e descobrir
               * depois que falta o roteiro deixaria o técnico sem o que fazer.
               */
              maintenanceType: {
                include: {
                  checklistTemplate: {
                    select: {
                      id: true,
                      key: true,
                      name: true,
                      version: true,
                      items: true,
                    },
                  },
                },
              },
            },
          },
          execution: true,
        },
      });
      const authorizationRequired = await assignmentAuthorizationRequired(
        tx,
        input.organizationId,
      );
      if (
        authorizationRequired &&
        !occurrence.authorizedAt &&
        !input.authorizationBypass
      )
        throw new ForbiddenException(
          'A visita ainda aguarda autorização do proprietário.',
        );
      if (occurrence.execution)
        return { id: occurrence.execution.id, created: false };
      if (occurrence.status !== 'SCHEDULED')
        throw new Error('RVT_OCCURRENCE_NOT_STARTABLE');
      await this.assertProfessional(
        tx,
        input.organizationId,
        occurrence.businessUnitId,
        input.responsibleId,
        'FIELD_TECHNICIAN',
      );
      for (const userId of input.auxiliaries)
        await this.assertMember(
          tx,
          input.organizationId,
          occurrence.businessUnitId,
          userId,
        );
      const { description } = jsonObject(occurrence.configuration.procedure);
      const operation = await tx.operation.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: occurrence.businessUnitId,
          customerId: occurrence.configuration.customerId,
          code: `RVT-${occurrence.configuration.code}-${String(occurrence.sequenceNumber).padStart(3, '0')}`,
          kind: 'INSPECTION',
          title: `${occurrence.configuration.name} — visita ${String(occurrence.sequenceNumber).padStart(3, '0')}`,
          status: 'IN_PROGRESS',
          priority: 'NORMAL',
          scheduledStart: occurrence.scheduledFor,
          location: rvtJson(occurrence.configuration.serviceLocation),
          description: typeof description === 'string' ? description : null,
          startedAt: new Date(),
          startedByUserId: input.actorId,
          createdById: input.actorId,
          responsibleFieldTechnicianId: input.responsibleId,
          authorizedAt:
            occurrence.authorizedAt ??
            (authorizationRequired ? null : new Date()),
          authorizedById: occurrence.authorizedById,
          data: { source: 'RVT', occurrenceId: occurrence.id },
          users: {
            create: {
              userId: input.responsibleId,
              assignedById: input.actorId,
            },
          },
          auxiliaryTechnicians: {
            create: input.auxiliaries.map((userId) => ({
              organizationId: input.organizationId,
              userId,
              assignedById: input.actorId,
            })),
          },
        },
      });
      const assets = await tx.asset.findMany({
        where: {
          id: {
            in: occurrence.equipmentIds.length
              ? occurrence.equipmentIds
              : occurrence.configuration.equipment.map((x) => x.assetId),
          },
          organizationId: input.organizationId,
          businessUnitId: occurrence.businessUnitId,
          customerId: occurrence.configuration.customerId,
          deletedAt: null,
        },
        select: equipmentSnapshotSelect,
      });
      const expectedEquipmentIds = occurrence.equipmentIds.length
        ? occurrence.equipmentIds
        : occurrence.configuration.equipment.map((x) => x.assetId);
      if (!expectedEquipmentIds.length)
        throw new Error('RVT_VISIT_EQUIPMENT_REQUIRED');
      if (assets.length !== expectedEquipmentIds.length)
        throw new Error('BUSINESS_UNIT_SCOPE_INVALID');
      if (assets.length)
        await tx.operationAsset.createMany({
          data: assets.map((asset) => ({
            operationId: operation.id,
            assetId: asset.id,
          })),
        });
      const configurationSnapshot = {
        configurationId: occurrence.configuration.id,
        code: occurrence.configuration.code,
        name: occurrence.configuration.name,
        /**
         * O tipo de manutenção, congelado no que ele era na hora da visita.
         *
         * O rótulo vai junto do id de propósito: o dono da organização pode
         * renomear "Trimestral" depois, e um relatório emitido tem de continuar
         * dizendo o que dizia.
         */
        maintenanceType: occurrence.configuration.maintenanceType
          ? {
              id: occurrence.configuration.maintenanceType.id,
              key: occurrence.configuration.maintenanceType.key,
              label: occurrence.configuration.maintenanceType.label,
            }
          : null,
        scheduleMode: occurrence.configuration.scheduleMode,
        timezone: occurrence.configuration.timezone,
        customerId: occurrence.configuration.customerId,
        serviceLocation: occurrence.configuration.serviceLocation,
        occurrence: {
          id: occurrence.id,
          sequenceNumber: occurrence.sequenceNumber,
          scheduledFor: occurrence.scheduledFor,
        },
      };
      const execution = await tx.rvtExecution.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: occurrence.businessUnitId,
          occurrenceId: occurrence.id,
          operationId: operation.id,
          responsibleFieldTechnicianId: input.responsibleId,
          technicalResponsibleUserId:
            occurrence.configuration.technicalResponsibleUserId,
          procedureSnapshot: rvtJson(occurrence.configuration.procedure),
          configurationSnapshot: rvtJson(configurationSnapshot),
          startedById: input.actorId,
          equipment: {
            create: assets.map((asset) => ({
              organizationId: input.organizationId,
              assetId: asset.id,
              assetSnapshot: rvtJson(asset),
              addedById: input.actorId,
            })),
          },
        },
      });
      /**
       * O checklist do tipo de manutenção nasce com a visita.
       *
       * Reusa `ChecklistExecution` — o mesmo modelo dos atendimentos, cujo
       * `operationId` sempre foi opcional. Vem de graça o snapshot do roteiro,
       * as respostas, o progresso e a conclusão, além dos endpoints que o
       * aplicativo de campo já usa para responder item a item.
       *
       * O snapshot é o que torna o relatório estável: editar o roteiro no
       * catálogo depois não reescreve a visita que já aconteceu.
       *
       * Tipo sem roteiro não cria checklist — e é um caso legítimo, não erro.
       */
      const roteiro =
        occurrence.configuration.maintenanceType?.checklistTemplate;
      if (roteiro) {
        const answers = checklistDefaults(roteiro.items);
        const items = Array.isArray(roteiro.items) ? roteiro.items : [];
        await tx.checklistExecution.create({
          data: {
            id: generateUuidV7(),
            organizationId: input.organizationId,
            businessUnitId: occurrence.businessUnitId,
            templateId: roteiro.id,
            rvtExecutionId: execution.id,
            operationId: operation.id,
            createdById: input.actorId,
            templateVersion: roteiro.version,
            answers,
            progress: items.length
              ? Math.round((Object.keys(answers).length / items.length) * 100)
              : 100,
            templateSnapshot: rvtJson({
              id: roteiro.id,
              key: roteiro.key,
              name: roteiro.name,
              version: roteiro.version,
              items: roteiro.items,
            }),
          },
        });
      }

      await tx.rvtOccurrence.update({
        where: { id: occurrence.id },
        data: {
          status: 'IN_PROGRESS',
          responsibleFieldTechnicianId: input.responsibleId,
        },
      });
      await this.audit(
        tx,
        input.organizationId,
        occurrence.businessUnitId,
        input.actorId,
        'RVT_EXECUTION_STARTED',
        execution.id,
        { occurrenceId: occurrence.id, operationId: operation.id },
      );
      return { id: execution.id, created: true };
    });
  }

  createAdHoc(
    input: CreateAdHocRvtCommand,
    idempotencyKey: string,
    payloadHash: string,
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:ad-hoc:${input.organizationId}:${input.actorId}:${idempotencyKey}`}))`;
      const existing = await tx.rvtAdHocCommand.findUnique({
        where: {
          organizationId_actorId_idempotencyKey: {
            organizationId: input.organizationId,
            actorId: input.actorId,
            idempotencyKey,
          },
        },
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new Error('RVT_IDEMPOTENCY_PAYLOAD_MISMATCH');
        return { executionId: existing.executionId, created: false };
      }
      const unit = await tx.businessUnit.findFirst({
        where: {
          id: input.businessUnitId,
          organizationId: input.organizationId,
          status: 'ACTIVE',
          deletedAt: null,
        },
      });
      if (!unit) throw new Error('BUSINESS_UNIT_SCOPE_INVALID');
      const responsibleId = input.responsibleFieldTechnicianId ?? input.actorId;
      await this.assertProfessional(
        tx,
        input.organizationId,
        input.businessUnitId,
        responsibleId,
        'FIELD_TECHNICIAN',
      );
      for (const auxiliaryId of input.auxiliaryTechnicianIds ?? [])
        await this.assertMember(
          tx,
          input.organizationId,
          input.businessUnitId,
          auxiliaryId,
        );
      if (Boolean(input.customerId) === Boolean(input.customer))
        throw new Error('RVT_AD_HOC_CUSTOMER_CHOICE_INVALID');
      let customerId = input.customerId;
      if (customerId) {
        const customer = await tx.customer.findFirst({
          where: {
            id: customerId,
            organizationId: input.organizationId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (!customer) throw new Error('BUSINESS_UNIT_SCOPE_INVALID');
      } else {
        const contextual = input.customer;
        if (!contextual) throw new Error('RVT_AD_HOC_CUSTOMER_CHOICE_INVALID');
        const customer = await tx.customer.create({
          data: {
            organizationId: input.organizationId,
            type: contextual.type ?? 'COMPANY',
            legalName: contextual.legalName,
            tradeName: contextual.tradeName,
            documentNumber: contextual.documentNumber?.replace(/\D/g, ''),
            email: contextual.email,
            phone: contextual.phone,
            address: rvtJson(contextual.address),
            status: 'ACTIVE',
            contacts: contextual.contactName
              ? {
                  create: {
                    organizationId: input.organizationId,
                    businessUnitId: input.businessUnitId,
                    name: contextual.contactName,
                    email: contextual.email,
                    phone: contextual.phone,
                    isPrimary: true,
                  },
                }
              : undefined,
          },
          select: { id: true },
        });
        customerId = customer.id;
        await this.audit(
          tx,
          input.organizationId,
          input.businessUnitId,
          input.actorId,
          'RVT_CONTEXTUAL_CUSTOMER_REGISTERED',
          customer.id,
          { command: 'RVT_AD_HOC' },
        );
      }
      const requestedAssets = await tx.asset.findMany({
        where: {
          id: { in: input.equipmentIds ?? [] },
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId,
          deletedAt: null,
        },
        select: equipmentSnapshotSelect,
      });
      if (requestedAssets.length !== (input.equipmentIds ?? []).length)
        throw new Error('BUSINESS_UNIT_SCOPE_INVALID');
      let contextualAsset: (typeof requestedAssets)[number] | null = null;
      if (input.equipment) {
        contextualAsset = await tx.asset.create({
          data: {
            organizationId: input.organizationId,
            businessUnitId: input.businessUnitId,
            customerId,
            category: input.equipment.category,
            name: input.equipment.name,
            manufacturer: input.equipment.manufacturer,
            model: input.equipment.model,
            serialNumber: input.equipment.serialNumber,
            location: input.equipment.location,
            status: 'ACTIVE',
          },
          select: equipmentSnapshotSelect,
        });
        requestedAssets.push(contextualAsset);
      }
      const identity = generateUuidV7();
      const code = `ADHOC-${identity.slice(0, 18)}`;
      const today = input.coverageStart;
      const configuration = await tx.rvtConfiguration.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId,
          code,
          name: input.name,
          maintenanceTypeId: input.maintenanceTypeId,
          scheduleMode: 'ONE_TIME',
          coverageStart: this.date(today),
          timezone: input.timezone,
          serviceLocation: rvtJson(input.serviceLocation),
          recurrence: Prisma.JsonNull,
          procedure: rvtJson(input.procedure),
          defaultResponsibleFieldTechnicianId: responsibleId,
          status: 'ACTIVE',
          metadata: rvtJson({ source: 'RVT_AD_HOC' }),
          createdById: input.actorId,
          equipment: {
            create: requestedAssets.map((asset) => ({
              organizationId: input.organizationId,
              assetId: asset.id,
            })),
          },
        },
      });
      const scheduledFor = input.scheduledFor;
      const occurrence = await tx.rvtOccurrence.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          configurationId: configuration.id,
          sequenceNumber: 1,
          scheduledFor,
          localScheduledDate: this.date(today),
          status: 'IN_PROGRESS',
          responsibleFieldTechnicianId: responsibleId,
          equipmentIds: requestedAssets.map((asset) => asset.id),
        },
      });
      const calendar = await resolveRvtCalendar(
        tx,
        input.organizationId,
        input.businessUnitId,
        input.timezone,
      );
      const schedulingEventId = await projectRvtOccurrence(tx, {
        occurrenceId: occurrence.id,
        organizationId: input.organizationId,
        businessUnitId: input.businessUnitId,
        customerId,
        actorId: input.actorId,
        calendarId: calendar.id,
        title: `${input.name} — visita 001`,
        startsAt: scheduledFor,
        timezone: input.timezone,
        location: input.serviceLocation,
        responsibleUserId: responsibleId,
      });
      await tx.rvtOccurrence.update({
        where: { id: occurrence.id },
        data: { schedulingEventId },
      });
      const operation = await tx.operation.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId,
          code: `RVT-${code}-001`,
          kind: 'INSPECTION',
          title: `${input.name} — visita 001`,
          status: 'IN_PROGRESS',
          priority: 'NORMAL',
          scheduledStart: scheduledFor,
          location: rvtJson(input.serviceLocation),
          description:
            typeof input.procedure?.description === 'string'
              ? input.procedure.description
              : null,
          startedAt: new Date(),
          startedByUserId: input.actorId,
          createdById: input.actorId,
          responsibleFieldTechnicianId: responsibleId,
          data: { source: 'RVT', occurrenceId: occurrence.id },
          users: {
            create: { userId: responsibleId, assignedById: input.actorId },
          },
          auxiliaryTechnicians: {
            create: [...new Set(input.auxiliaryTechnicianIds ?? [])].map(
              (userId: string) => ({
                organizationId: input.organizationId,
                userId,
                assignedById: input.actorId,
              }),
            ),
          },
        },
      });
      const configurationSnapshot = {
        configurationId: configuration.id,
        code,
        name: input.name,
        scheduleMode: 'ONE_TIME',
        timezone: input.timezone,
        customerId,
        serviceLocation: input.serviceLocation,
        occurrence: {
          id: occurrence.id,
          sequenceNumber: 1,
          scheduledFor,
        },
      };
      const execution = await tx.rvtExecution.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          occurrenceId: occurrence.id,
          operationId: operation.id,
          responsibleFieldTechnicianId: responsibleId,
          procedureSnapshot: rvtJson(input.procedure),
          configurationSnapshot: rvtJson(configurationSnapshot),
          startedById: input.actorId,
          equipment: {
            create: requestedAssets.map((asset) => ({
              organizationId: input.organizationId,
              assetId: asset.id,
              assetSnapshot: rvtJson(asset),
              addedDuringExecution: asset.id === contextualAsset?.id,
              addedById: input.actorId,
            })),
          },
        },
      });
      if (contextualAsset)
        await this.audit(
          tx,
          input.organizationId,
          input.businessUnitId,
          input.actorId,
          'RVT_CONTEXTUAL_EQUIPMENT_REGISTERED',
          contextualAsset.id,
          { executionId: execution.id },
        );
      await tx.rvtAdHocCommand.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          actorId: input.actorId,
          idempotencyKey,
          payloadHash,
          configurationId: configuration.id,
          occurrenceId: occurrence.id,
          executionId: execution.id,
          operationId: operation.id,
          customerId,
          assetId: contextualAsset?.id ?? null,
        },
      });
      await this.audit(
        tx,
        input.organizationId,
        input.businessUnitId,
        input.actorId,
        'RVT_AD_HOC_CREATED',
        execution.id,
        { configurationId: configuration.id, occurrenceId: occurrence.id },
      );
      return { executionId: execution.id, created: true };
    });
  }

  execution(
    id: string,
    organizationId: string,
  ): Promise<RvtExecutionSource | null> {
    return this.rls.run(async (tx) => {
      const execution = await tx.rvtExecution.findFirst({
        where: { id, organizationId },
        include: executionView,
      });
      if (!execution) return null;
      const users = await tx.user.findMany({
        where: {
          id: {
            in: [
              execution.responsibleFieldTechnicianId,
              execution.technicalResponsibleUserId ??
                '00000000-0000-0000-0000-000000000000',
            ],
          },
        },
        select: { id: true, displayName: true },
      });
      const operation = execution.operationId
        ? await tx.operation.findFirst({
            where: { id: execution.operationId },
            select: {
              id: true,
              code: true,
              status: true,
              auxiliaryTechnicians: {
                where: { removedAt: null },
                select: { user: { select: { id: true, displayName: true } } },
              },
            },
          })
        : null;
      const artifact = execution.artifactExecutionId
        ? await tx.artifactExecution.findFirst({
            where: { id: execution.artifactExecutionId },
            select: { id: true, code: true, status: true, renderStatus: true },
          })
        : null;
      return {
        ...execution,
        assignmentAuthorizationRequired: await assignmentAuthorizationRequired(
          tx,
          organizationId,
        ),
        fieldTechnicianName:
          users.find((x) => x.id === execution.responsibleFieldTechnicianId)
            ?.displayName ?? '',
        technicalResponsibleName:
          users.find((x) => x.id === execution.technicalResponsibleUserId)
            ?.displayName ?? '',
        auxiliaryTechnicians:
          operation?.auxiliaryTechnicians.map((x) => ({
            id: x.user.id,
            name: x.user.displayName,
          })) ?? [],
        operation: operation
          ? { id: operation.id, code: operation.code, status: operation.status }
          : null,
        artifact,
      };
    });
  }

  updateExecution(
    id: string,
    organizationId: string,
    actorId: string,
    input: UpdateRvtExecutionDto,
  ) {
    return this.rls.run(async (tx) => {
      const current = await tx.rvtExecution.findFirstOrThrow({
        where: { id, organizationId, status: 'IN_PROGRESS' },
      });
      await tx.rvtExecution.update({
        where: { id },
        data: {
          procedureSnapshot: input.procedure
            ? rvtJson(input.procedure)
            : undefined,
          observations: input.observations
            ? rvtJson(input.observations)
            : undefined,
          recommendations: input.recommendations
            ? rvtJson(input.recommendations)
            : undefined,
          freeTextRecommendation: input.freeTextRecommendation,
        },
      });
      await this.audit(
        tx,
        organizationId,
        current.businessUnitId,
        actorId,
        'RVT_EXECUTION_UPDATED',
        id,
        {},
      );
    });
  }

  addEquipment(
    id: string,
    organizationId: string,
    actorId: string,
    assetId: string,
    addedDuringExecution = true,
  ) {
    return this.rls.run(async (tx) => {
      const execution = await tx.rvtExecution.findFirstOrThrow({
        where: { id, organizationId, status: 'IN_PROGRESS' },
        include: { occurrence: { include: { configuration: true } } },
      });
      const asset = await tx.asset.findFirstOrThrow({
        where: {
          id: assetId,
          organizationId,
          businessUnitId: execution.businessUnitId,
          customerId: execution.occurrence.configuration.customerId,
          deletedAt: null,
        },
        select: equipmentSnapshotSelect,
      });
      await tx.rvtExecutionEquipment.upsert({
        where: { executionId_assetId: { executionId: id, assetId } },
        create: {
          organizationId,
          executionId: id,
          assetId,
          assetSnapshot: rvtJson(asset),
          addedDuringExecution,
          addedById: actorId,
        },
        update: {},
      });
      await this.audit(
        tx,
        organizationId,
        execution.businessUnitId,
        actorId,
        'RVT_EQUIPMENT_ADDED',
        id,
        { assetId },
      );
    });
  }

  registerEquipment(
    id: string,
    organizationId: string,
    actorId: string,
    input: RegisterRvtEquipmentDto,
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:asset:${id}:${input.serialNumber ?? input.name}`}))`;
      const execution = await tx.rvtExecution.findFirstOrThrow({
        where: { id, organizationId, status: 'IN_PROGRESS' },
        include: { occurrence: { include: { configuration: true } } },
      });
      const asset = await tx.asset.create({
        data: {
          organizationId,
          businessUnitId: execution.businessUnitId,
          customerId: execution.occurrence.configuration.customerId,
          name: input.name,
          category: input.category,
          manufacturer: input.manufacturer,
          model: input.model,
          serialNumber: input.serialNumber,
          location: input.location,
          status: 'ACTIVE',
        },
        select: equipmentSnapshotSelect,
      });
      await tx.rvtExecutionEquipment.create({
        data: {
          organizationId,
          executionId: id,
          assetId: asset.id,
          assetSnapshot: rvtJson(asset),
          addedDuringExecution: true,
          addedById: actorId,
        },
      });
      await tx.rvtConfigurationEquipment.upsert({
        where: {
          configurationId_assetId: {
            configurationId: execution.occurrence.configurationId,
            assetId: asset.id,
          },
        },
        create: {
          organizationId,
          configurationId: execution.occurrence.configurationId,
          assetId: asset.id,
        },
        update: { removedAt: null },
      });
      await this.audit(
        tx,
        organizationId,
        execution.businessUnitId,
        actorId,
        'RVT_CONTEXTUAL_EQUIPMENT_REGISTERED',
        asset.id,
        { executionId: id },
      );
      return asset.id;
    });
  }

  addEvidence(
    id: string,
    organizationId: string,
    actorId: string,
    input: AddRvtEvidenceDto,
  ) {
    return this.rls.run(async (tx) => {
      await tx.rvtExecution.findFirstOrThrow({
        where: { id, organizationId, status: 'IN_PROGRESS' },
      });
      const file = await tx.storageFile.findFirstOrThrow({
        where: {
          id: input.storageFileId,
          organizationId,
          status: 'AVAILABLE',
          deletedAt: null,
        },
      });
      if (file.sizeBytes > 20_000_000n)
        throw new Error('RVT_EVIDENCE_TOO_LARGE');
      await tx.rvtExecutionEvidence.upsert({
        where: {
          executionId_storageFileId: {
            executionId: id,
            storageFileId: file.id,
          },
        },
        create: {
          organizationId,
          executionId: id,
          storageFileId: file.id,
          assetId: input.assetId,
          kind: input.kind ?? 'PHOTO',
          caption: input.caption,
          uploadedById: actorId,
        },
        update: {},
      });
    });
  }

  acknowledge(
    id: string,
    organizationId: string,
    actorId: string,
    input: CaptureCustomerAcknowledgementDto,
  ) {
    return this.rls.run(async (tx) => {
      const execution = await tx.rvtExecution.findFirstOrThrow({
        where: { id, organizationId, status: 'IN_PROGRESS' },
      });
      const file = await tx.storageFile.findFirstOrThrow({
        where: {
          id: input.storageFileId,
          organizationId,
          status: 'AVAILABLE',
          deletedAt: null,
        },
      });
      const snapshot = {
        name: input.name,
        storageFileId: file.id,
        hash: file.sha256,
        signedAt: (input.signedAt ?? new Date()).toISOString(),
        capturedBy: actorId,
      };
      await tx.rvtExecution.update({
        where: { id },
        data: { customerAcknowledgement: rvtJson(snapshot) },
      });
      await this.audit(
        tx,
        organizationId,
        execution.businessUnitId,
        actorId,
        'RVT_CUSTOMER_ACKNOWLEDGED',
        id,
        {},
      );
    });
  }

  complete(
    id: string,
    organizationId: string,
    actorId: string,
    performedAt: Date,
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:complete:${id}`}))`;
      const execution = await tx.rvtExecution.findFirstOrThrow({
        where: { id, organizationId },
        include: { occurrence: { include: { configuration: true } } },
      });
      if (execution.status === 'COMPLETED') return { id, created: false };
      if (execution.status !== 'IN_PROGRESS')
        throw new Error('RVT_EXECUTION_NOT_COMPLETABLE');
      const signature = await tx.userSignature.findFirst({
        where: {
          organizationId,
          userId: execution.responsibleFieldTechnicianId,
          active: true,
          revokedAt: null,
        },
        include: { user: { select: { displayName: true } } },
      });
      if (!signature) throw new Error('FIELD_TECHNICIAN_SIGNATURE_MISSING');
      const fieldSnapshot = {
        userId: execution.responsibleFieldTechnicianId,
        name: signature.user.displayName,
        signatureAssetId: signature.storageObjectId,
        hash: signature.sha256,
        version: signature.version,
        signedAs: 'FIELD_TECHNICIAN',
      };
      let rtSnapshot: ReturnType<typeof rvtJson> | undefined;
      if (execution.occurrence.configuration.requiresTechnicalResponsible) {
        if (!execution.technicalResponsibleUserId)
          throw new Error('TECHNICAL_RESPONSIBLE_NOT_ELIGIBLE');
        const rt = await tx.userSignature.findFirst({
          where: {
            organizationId,
            userId: execution.technicalResponsibleUserId,
            active: true,
            revokedAt: null,
          },
          include: {
            user: { select: { displayName: true } },
            storageObject: true,
          },
        });
        if (!rt) throw new Error('TECHNICAL_RESPONSIBLE_SIGNATURE_MISSING');
        const credential = await tx.professionalCredential.findFirst({
          where: {
            organizationId,
            userId: execution.technicalResponsibleUserId,
            active: true,
            revokedAt: null,
          },
        });
        rtSnapshot = rvtJson({
          userId: execution.technicalResponsibleUserId,
          name: rt.user.displayName,
          signatureAssetId: rt.storageObjectId,
          hash: rt.sha256,
          credential,
          signedAs: 'TECHNICAL_RESPONSIBLE',
        });
      }
      await tx.rvtExecution.update({
        where: { id },
        data: {
          status: 'COMPLETED',
          performedAt,
          completedAt: new Date(),
          completedById: actorId,
          fieldTechnicianSignature: rvtJson(fieldSnapshot),
          technicalResponsibleSignature: rtSnapshot,
        },
      });
      await tx.rvtOccurrence.update({
        where: { id: execution.occurrenceId },
        data: { status: 'COMPLETED' },
      });
      if (execution.operationId)
        await tx.operation.update({
          where: { id: execution.operationId },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            completedByUserId: actorId,
          },
        });
      await this.audit(
        tx,
        organizationId,
        execution.businessUnitId,
        actorId,
        'RVT_EXECUTION_COMPLETED',
        id,
        { occurrenceId: execution.occurrenceId },
      );
      return { id, created: true };
    });
  }

  generateArtifact(id: string, organizationId: string, actorId: string) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:artifact:${id}`}))`;
      const execution = await tx.rvtExecution.findFirstOrThrow({
        where: { id, organizationId },
        include: rvtReportExecutionView,
      });
      if (execution.status !== 'COMPLETED')
        throw new Error('RVT_EXECUTION_NOT_COMPLETED');
      if (execution.artifactExecutionId)
        return {
          artifactExecutionId: execution.artifactExecutionId,
          created: false,
        };
      const template = await tx.artifactTemplate.findFirst({
        where: {
          artifactType: 'RELATORIO_VISITA',
          status: 'ACTIVE',
          deletedAt: null,
          OR: [
            { organizationId },
            { organizationId: null, visibility: 'GLOBAL' },
          ],
        },
        orderBy: { organizationId: 'desc' },
      });
      if (!template) throw new Error('RVT_ARTIFACT_TEMPLATE_NOT_FOUND');
      const version = await tx.artifactTemplateVersion.findUniqueOrThrow({
        where: {
          templateId_version: {
            templateId: template.id,
            version: template.currentVersion,
          },
        },
      });
      const structure = {
        metadata: version.metadata,
        sections: version.sections,
        signatureSlots: version.signatureSlots,
        layout: version.layout,
      };
      const snapshot = await tx.artifactSnapshot.create({
        data: {
          organizationId,
          templateId: template.id,
          templateVersionId: version.id,
          templateVersion: version.version,
          templateKey: template.key,
          templateName: template.name,
          artifactType: template.artifactType,
          segment: template.segment,
          metadata: rvtJson(version.metadata),
          sections: rvtJson(version.sections),
          signatureSlots: rvtJson(version.signatureSlots),
          layout: rvtJson(version.layout),
          structureHash: createHash('sha256')
            .update(JSON.stringify(structure))
            .digest('hex'),
        },
      });
      const code = `RVT-${execution.occurrence.configuration.code}-${String(execution.occurrence.sequenceNumber).padStart(3, '0')}`;
      const documentSnapshot = rvtReportSnapshot(execution);
      const artifact = await tx.artifactExecution.create({
        data: {
          organizationId,
          businessUnitId: execution.businessUnitId,
          operationId: execution.operationId,
          customerId: execution.occurrence.configuration.customerId,
          templateId: template.id,
          snapshotId: snapshot.id,
          responsibleUserId: execution.responsibleFieldTechnicianId,
          createdById: actorId,
          code,
          title: `${execution.occurrence.configuration.name} — RVT ${String(execution.occurrence.sequenceNumber).padStart(3, '0')}`,
          status: 'COMPLETED',
          progress: 100,
          startedAt: execution.startedAt,
          completedAt: execution.completedAt,
          context: rvtJson({
            source: 'RVT',
            rvtExecutionId: id,
            documentSnapshot,
          }),
        },
        select: { id: true },
      });
      await tx.rvtExecution.update({
        where: { id },
        data: { artifactExecutionId: artifact.id },
      });
      await this.audit(
        tx,
        organizationId,
        execution.businessUnitId,
        actorId,
        'RVT_ARTIFACT_CREATED',
        artifact.id,
        { rvtExecutionId: id },
      );
      return { artifactExecutionId: artifact.id, created: true };
    });
  }

  private async assertScope(
    tx: PrismaTransactionClient,
    organizationId: string,
    businessUnitId: string,
    customerId: string,
    equipmentIds: string[],
  ) {
    const unit = await tx.businessUnit.findFirst({
      where: { id: businessUnitId, organizationId, deletedAt: null },
      select: { id: true },
    });
    const customer = await tx.customer.findFirst({
      where: { id: customerId, organizationId, deletedAt: null },
      select: { id: true },
    });
    const count = await tx.asset.count({
      where: {
        id: { in: equipmentIds },
        organizationId,
        businessUnitId,
        customerId,
        deletedAt: null,
      },
    });
    if (!unit || !customer || count !== equipmentIds.length)
      throw new Error('BUSINESS_UNIT_SCOPE_INVALID');
  }
  private async assertMember(
    tx: PrismaTransactionClient,
    organizationId: string,
    businessUnitId: string,
    userId: string,
  ) {
    const row = await tx.organizationMembership.findFirst({
      where: {
        organizationId,
        userId,
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
    const unit = await tx.businessUnitMembership.findFirst({
      where: {
        organizationId,
        businessUnitId,
        userId,
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
    if (!row || !unit) throw new Error('BUSINESS_UNIT_SCOPE_INVALID');
  }
  private async assertProfessional(
    tx: PrismaTransactionClient,
    organizationId: string,
    businessUnitId: string,
    userId: string,
    role: 'FIELD_TECHNICIAN' | 'TECHNICAL_RESPONSIBLE',
  ) {
    if (
      role === 'FIELD_TECHNICIAN' &&
      (await tx.organization.findFirst({
        where: { id: organizationId, ownerUserId: userId, deletedAt: null },
        select: { id: true },
      }))
    )
      return;
    await this.assertMember(tx, organizationId, businessUnitId, userId);
    const p = await tx.professionalProfile.findFirst({
      where: {
        organizationId,
        userId,
        active: true,
        ...(role === 'FIELD_TECHNICIAN'
          ? { fieldTechnicianEnabled: true }
          : { technicalResponsibleEnabled: true }),
      },
    });
    if (!p) throw new Error(`${role}_NOT_ELIGIBLE`);
  }
  private audit(
    tx: PrismaTransactionClient,
    organizationId: string,
    businessUnitId: string,
    userId: string,
    action: string,
    entityId: string,
    after: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        businessUnitId,
        userId,
        action,
        entityType: 'RVT',
        entityId,
        after: rvtJson(after),
      },
    });
  }
  private date(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }
}
