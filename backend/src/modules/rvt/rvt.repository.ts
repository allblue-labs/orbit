/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, orbit/no-concurrent-transaction-queries */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import type { OccurrenceCandidate } from './rvt.domain';

/**
 * O roteiro vem junto do tipo em toda leitura.
 *
 * É ele que o técnico preenche em campo e o que o relatório final descreve; um
 * tipo lido sem o roteiro obrigaria uma segunda consulta em todo lugar que
 * precisa saber se há o que preencher.
 */
const maintenanceTypeView = {
  checklistTemplate: {
    select: { id: true, key: true, name: true, version: true, items: true },
  },
} satisfies Prisma.RvtMaintenanceTypeInclude;

@Injectable()
export class RvtRepository {
  constructor(private readonly rls: RlsTransaction) {}

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
    input: any,
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
      const configuration = await tx.rvtConfiguration.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          customerId: input.customerId,
          code: input.code,
          name: input.name,
          maintenanceTypeId: input.maintenanceTypeId,
          scheduleMode: input.scheduleMode,
          coverageStart: this.date(input.coverageStart),
          coverageEnd: input.coverageEnd ? this.date(input.coverageEnd) : null,
          timezone: input.timezone,
          serviceLocation: this.json(input.serviceLocation),
          recurrence: input.recurrence
            ? this.json(input.recurrence)
            : Prisma.JsonNull,
          procedure: this.json(input.procedure),
          technicalResponsibleUserId: input.technicalResponsibleUserId ?? null,
          defaultResponsibleFieldTechnicianId:
            input.defaultResponsibleFieldTechnicianId ?? null,
          requiresTechnicalResponsible:
            input.requiresTechnicalResponsible ?? false,
          metadata: this.json(input.metadata ?? {}),
          createdById: actorId,
          equipment: {
            create: (input.equipmentIds ?? []).map((assetId: string) => ({
              organizationId: input.organizationId,
              assetId,
            })),
          },
        },
      });
      const calendar = await this.resolveCalendar(
        tx,
        input.organizationId,
        input.businessUnitId,
        input.timezone,
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
          },
        });
        const schedulingEventId = await this.createSchedulingProjection(tx, {
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

  async listConfigurations(organizationId: string, query: any) {
    return this.rls
      .run((tx) =>
        tx.rvtConfiguration.findMany({
          where: {
            organizationId,
            deletedAt: null,
            businessUnitId: query.businessUnitId,
            customerId: query.customerId,
            status: query.status,
          },
          orderBy: { createdAt: 'desc' },
          take: query.limit ?? 50,
          select: { id: true },
        }),
      )
      .then((rows) =>
        Promise.all(
          rows.map((row) => this.configuration(row.id, organizationId)),
        ),
      );
  }

  updateConfiguration(
    id: string,
    organizationId: string,
    actorId: string,
    input: any,
    candidates: OccurrenceCandidate[],
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:configuration:${id}`}))`;
      const current = await tx.rvtConfiguration.findFirstOrThrow({
        where: { id, organizationId, deletedAt: null },
      });
      if (current.scheduleMode === 'ONE_TIME' && input.scheduleMode)
        throw new Error('RVT_SCHEDULE_MODE_IMMUTABLE');
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
          input.defaultResponsibleFieldTechnicianId ??
          current.defaultResponsibleFieldTechnicianId,
      };
      await tx.rvtConfiguration.update({
        where: { id },
        data: {
          name: input.name,
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
            ? this.json(input.serviceLocation)
            : undefined,
          recurrence: input.recurrence
            ? this.json(input.recurrence)
            : undefined,
          procedure: input.procedure ? this.json(input.procedure) : undefined,
          technicalResponsibleUserId: input.technicalResponsibleUserId,
          defaultResponsibleFieldTechnicianId:
            input.defaultResponsibleFieldTechnicianId,
          requiresTechnicalResponsible: input.requiresTechnicalResponsible,
          metadata: input.metadata ? this.json(input.metadata) : undefined,
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
        select: { localScheduledDate: true },
      });
      for (const item of immutableDates) {
        if (item.localScheduledDate)
          desiredByDate.delete(
            item.localScheduledDate.toISOString().slice(0, 10),
          );
      }
      const calendar = await this.resolveCalendar(
        tx,
        organizationId,
        current.businessUnitId,
        effective.timezone,
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
        const schedulingEventId = await this.createSchedulingProjection(tx, {
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
          },
        });
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
          },
        });
        const schedulingEventId = await this.createSchedulingProjection(tx, {
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
    return this.rls.run(async (tx) => {
      const rows = await tx.$queryRaw<
        any[]
      >`SELECT c.*, COALESCE(b.trade_name,b.legal_name) AS "businessUnitName", COALESCE(cu.trade_name,cu.legal_name) AS "customerName", tr.display_name AS "technicalResponsibleName", ft.display_name AS "fieldTechnicianName", mt.id AS "mtId", mt.key AS "mtKey", mt.label AS "mtLabel", mt.interval_days AS "mtIntervalDays", mt.interval_months AS "mtIntervalMonths", ct.id AS "mtChecklistId", ct.name AS "mtChecklistName", ct.version AS "mtChecklistVersion" FROM rvt_configurations c JOIN business_units b ON b.id=c.business_unit_id JOIN customers cu ON cu.id=c.customer_id LEFT JOIN users tr ON tr.id=c.technical_responsible_user_id LEFT JOIN users ft ON ft.id=c.default_responsible_field_technician_id LEFT JOIN rvt_maintenance_types mt ON mt.id=c.maintenance_type_id LEFT JOIN checklist_templates ct ON ct.id=mt.checklist_template_id AND ct.deleted_at IS NULL WHERE c.id=${id}::uuid AND c.organization_id=${organizationId}::uuid AND c.deleted_at IS NULL`;
      const source = rows[0];
      if (!source) return null;
      source.businessUnitId = source.business_unit_id;
      source.customerId = source.customer_id;
      /**
       * O tipo de manutenção, montado a partir do JOIN.
       *
       * Esta consulta é **SQL cru**, e por isso o compilador não a acompanhou
       * quando `visit_type` deixou de existir: a linha antiga era
       * `source.visitType = source.visit_type`, que passou a produzir
       * `undefined` em silêncio — sem erro de tipo e sem erro de banco. Foi a
       * verificação contra a API viva que mostrou.
       */
      source.maintenanceType = source.mtId
        ? {
            id: source.mtId,
            key: source.mtKey,
            label: source.mtLabel,
            intervalDays: source.mtIntervalDays,
            intervalMonths: source.mtIntervalMonths,
            checklistTemplate: source.mtChecklistId
              ? {
                  id: source.mtChecklistId,
                  name: source.mtChecklistName,
                  version: source.mtChecklistVersion,
                }
              : null,
          }
        : null;
      source.scheduleMode = source.schedule_mode;
      source.coverageStart = source.coverage_start;
      source.coverageEnd = source.coverage_end;
      source.serviceLocation = source.service_location;
      source.technicalResponsibleId = source.technical_responsible_user_id;
      source.fieldTechnicianId = source.default_responsible_field_technician_id;
      source.requiresTechnicalResponsible =
        source.requires_technical_responsible;
      source.createdAt = source.created_at;
      source.updatedAt = source.updated_at;
      source.equipment = await tx.rvtConfigurationEquipment.findMany({
        where: { configurationId: id, removedAt: null },
        select: { assetId: true },
      });
      const assets = await tx.asset.findMany({
        where: {
          id: { in: source.equipment.map((link: any) => link.assetId) },
          organizationId,
        },
        select: {
          id: true,
          name: true,
          category: true,
          identifier: true,
          serialNumber: true,
        },
      });
      source.equipment = assets.map((asset) => ({ asset }));
      source.occurrences = await tx.rvtOccurrence.findMany({
        where: { configurationId: id },
        include: { execution: { select: { id: true } } },
        orderBy: { sequenceNumber: 'asc' },
      });
      return source;
    });
  }

  occurrence(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.rvtOccurrence.findFirst({
        where: { id, organizationId },
        include: { execution: { select: { id: true } }, configuration: true },
      }),
    );
  }

  listOccurrences(organizationId: string, query: any) {
    return this.rls.run((tx) =>
      tx.rvtOccurrence.findMany({
        where: {
          organizationId,
          businessUnitId: query.businessUnitId,
          status: query.status,
          ...(query.assignedToUserId
            ? {
                configuration: {
                  defaultResponsibleFieldTechnicianId: query.assignedToUserId,
                },
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

  timeline(configurationId: string, organizationId: string, query: any) {
    return this.rls.run(async (tx) => {
      const configuration = await tx.rvtConfiguration.findFirstOrThrow({
        where: { id: configurationId, organizationId, deletedAt: null },
        select: { businessUnitId: true },
      });
      const occurrences = await tx.rvtOccurrence.findMany({
        where: { configurationId },
        select: { id: true, execution: { select: { id: true } } },
      });
      const entityIds = [
        configurationId,
        ...occurrences.flatMap((item) => [
          item.id,
          ...(item.execution ? [item.execution.id] : []),
        ]),
      ];
      const executionIds = occurrences.flatMap((item) =>
        item.execution ? [item.execution.id] : [],
      );
      const cursor = query.cursor
        ? await tx.auditLog.findFirst({
            where: { id: query.cursor, organizationId },
            select: { createdAt: true },
          })
        : null;
      const rows = await tx.auditLog.findMany({
        where: {
          organizationId,
          businessUnitId: configuration.businessUnitId,
          entityType: 'RVT',
          ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}),
          OR: [
            { entityId: { in: entityIds } },
            { after: { path: ['configurationId'], equals: configurationId } },
            ...executionIds.map((executionId) => ({
              after: { path: ['executionId'], equals: executionId },
            })),
            ...executionIds.map((executionId) => ({
              after: { path: ['rvtExecutionId'], equals: executionId },
            })),
          ],
        },
        include: { user: { select: { id: true, displayName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: (query.limit ?? 20) + 1,
      });
      const hasNextPage = rows.length > (query.limit ?? 20);
      const data = rows.slice(0, query.limit ?? 20);
      const equipmentIds = data
        .filter((row) => row.action.includes('EQUIPMENT'))
        .map((row) => row.entityId)
        .filter((value): value is string => Boolean(value));
      const equipment = await tx.asset.findMany({
        where: { id: { in: equipmentIds }, organizationId },
        select: { id: true, name: true },
      });
      return {
        data,
        equipment,
        hasNextPage,
        nextCursor: hasNextPage ? (data.at(-1)?.id ?? null) : null,
      };
    });
  }

  startExecution(input: {
    organizationId: string;
    occurrenceId: string;
    actorId: string;
    responsibleId: string;
    auxiliaries: string[];
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`rvt:start:${input.occurrenceId}`}))`;
      const occurrence = await tx.rvtOccurrence.findFirstOrThrow({
        where: { id: input.occurrenceId, organizationId: input.organizationId },
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
          startedAt: new Date(),
          startedByUserId: input.actorId,
          createdById: input.actorId,
          responsibleFieldTechnicianId: input.responsibleId,
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
          id: { in: occurrence.configuration.equipment.map((x) => x.assetId) },
          organizationId: input.organizationId,
          businessUnitId: occurrence.businessUnitId,
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          category: true,
          identifier: true,
          serialNumber: true,
          manufacturer: true,
          model: true,
          location: true,
        },
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
          procedureSnapshot: this.json(occurrence.configuration.procedure),
          configurationSnapshot: this.json(configurationSnapshot),
          startedById: input.actorId,
          equipment: {
            create: assets.map((asset) => ({
              organizationId: input.organizationId,
              assetId: asset.id,
              assetSnapshot: this.json(asset),
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
        await tx.checklistExecution.create({
          data: {
            id: generateUuidV7(),
            organizationId: input.organizationId,
            businessUnitId: occurrence.businessUnitId,
            templateId: roteiro.id,
            rvtExecutionId: execution.id,
            createdById: input.actorId,
            templateVersion: roteiro.version,
            templateSnapshot: this.json({
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
        data: { status: 'IN_PROGRESS' },
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

  createAdHoc(input: any, idempotencyKey: string, payloadHash: string) {
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
      let customerId = input.customerId as string | undefined;
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
        const customer = await tx.customer.create({
          data: {
            organizationId: input.organizationId,
            type: input.customer.type ?? 'COMPANY',
            legalName: input.customer.legalName,
            tradeName: input.customer.tradeName,
            documentNumber: input.customer.documentNumber?.replace(/\D/g, ''),
            email: input.customer.email,
            phone: input.customer.phone,
            address: this.json(input.customer.address),
            status: 'ACTIVE',
            contacts: input.customer.contactName
              ? {
                  create: {
                    organizationId: input.organizationId,
                    businessUnitId: input.businessUnitId,
                    name: input.customer.contactName,
                    email: input.customer.email,
                    phone: input.customer.phone,
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
        select: {
          id: true,
          name: true,
          category: true,
          identifier: true,
          serialNumber: true,
          manufacturer: true,
          model: true,
          location: true,
        },
      });
      if (requestedAssets.length !== (input.equipmentIds ?? []).length)
        throw new Error('BUSINESS_UNIT_SCOPE_INVALID');
      let contextualAsset: any = null;
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
          select: {
            id: true,
            name: true,
            category: true,
            identifier: true,
            serialNumber: true,
            manufacturer: true,
            model: true,
            location: true,
          },
        });
        requestedAssets.push(contextualAsset);
      }
      const identity = generateUuidV7();
      const code = `ADHOC-${identity.slice(0, 18)}`;
      const today = input.coverageStart as string;
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
          serviceLocation: this.json(input.serviceLocation),
          recurrence: Prisma.JsonNull,
          procedure: this.json(input.procedure),
          defaultResponsibleFieldTechnicianId: responsibleId,
          status: 'ACTIVE',
          metadata: this.json({ source: 'RVT_AD_HOC' }),
          createdById: input.actorId,
          equipment: {
            create: requestedAssets.map((asset) => ({
              organizationId: input.organizationId,
              assetId: asset.id,
            })),
          },
        },
      });
      const scheduledFor = input.scheduledFor as Date;
      const occurrence = await tx.rvtOccurrence.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          configurationId: configuration.id,
          sequenceNumber: 1,
          scheduledFor,
          localScheduledDate: this.date(today),
          status: 'IN_PROGRESS',
        },
      });
      const calendar = await this.resolveCalendar(
        tx,
        input.organizationId,
        input.businessUnitId,
        input.timezone,
      );
      const schedulingEventId = await this.createSchedulingProjection(tx, {
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
          startedAt: new Date(),
          startedByUserId: input.actorId,
          createdById: input.actorId,
          responsibleFieldTechnicianId: responsibleId,
          data: { source: 'RVT', occurrenceId: occurrence.id },
          users: {
            create: { userId: responsibleId, assignedById: input.actorId },
          },
          auxiliaryTechnicians: {
            create: [
              ...new Set<string>(
                (input.auxiliaryTechnicianIds ?? []) as string[],
              ),
            ].map((userId: string) => ({
              organizationId: input.organizationId,
              userId,
              assignedById: input.actorId,
            })),
          },
        },
      });
      const configurationSnapshot = {
        configurationId: configuration.id,
        code,
        name: input.name,
        visitType: input.visitType,
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
          procedureSnapshot: this.json(input.procedure),
          configurationSnapshot: this.json(configurationSnapshot),
          startedById: input.actorId,
          equipment: {
            create: requestedAssets.map((asset) => ({
              organizationId: input.organizationId,
              assetId: asset.id,
              assetSnapshot: this.json(asset),
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

  execution(id: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const execution = await tx.rvtExecution.findFirst({
        where: { id, organizationId },
        include: {
          equipment: true,
          evidence: true,
          /**
           * O checklist da visita.
           *
           * Publicado no detalhe porque é o que o técnico abre para preencher
           * e o que a tela mostra como progresso da visita.
           */
          checklistExecutions: { orderBy: { createdAt: 'asc' } },
          occurrence: { include: { configuration: true } },
        },
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
      return Object.assign(execution, {
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
        operationCode: operation?.code,
        operationStatus: operation?.status,
        artifactCode: artifact?.code,
        artifactStatus: artifact?.status,
        artifactRenderStatus: artifact?.renderStatus,
      });
    });
  }

  updateExecution(
    id: string,
    organizationId: string,
    actorId: string,
    input: any,
  ) {
    return this.rls.run(async (tx) => {
      const current = await tx.rvtExecution.findFirstOrThrow({
        where: { id, organizationId, status: 'IN_PROGRESS' },
      });
      await tx.rvtExecution.update({
        where: { id },
        data: {
          procedureSnapshot: input.procedure
            ? this.json(input.procedure)
            : undefined,
          observations: input.observations
            ? this.json(input.observations)
            : undefined,
          recommendations: input.recommendations
            ? this.json(input.recommendations)
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
        select: {
          id: true,
          name: true,
          category: true,
          identifier: true,
          serialNumber: true,
          manufacturer: true,
          model: true,
          location: true,
        },
      });
      await tx.rvtExecutionEquipment.upsert({
        where: { executionId_assetId: { executionId: id, assetId } },
        create: {
          organizationId,
          executionId: id,
          assetId,
          assetSnapshot: this.json(asset),
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
    input: any,
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
        select: {
          id: true,
          name: true,
          category: true,
          identifier: true,
          serialNumber: true,
          manufacturer: true,
          model: true,
          location: true,
        },
      });
      await tx.rvtExecutionEquipment.create({
        data: {
          organizationId,
          executionId: id,
          assetId: asset.id,
          assetSnapshot: this.json(asset),
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

  addEvidence(id: string, organizationId: string, actorId: string, input: any) {
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

  acknowledge(id: string, organizationId: string, actorId: string, input: any) {
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
        data: { customerAcknowledgement: this.json(snapshot) },
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
      let rtSnapshot: Prisma.InputJsonValue | undefined;
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
        rtSnapshot = this.json({
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
          fieldTechnicianSignature: this.json(fieldSnapshot),
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
        include: {
          occurrence: { include: { configuration: true } },
          equipment: true,
          evidence: true,
          /** O checklist preenchido em campo entra no documento. */
          checklistExecutions: { orderBy: { createdAt: 'asc' }, take: 1 },
        },
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
          metadata: this.json(version.metadata),
          sections: this.json(version.sections),
          signatureSlots: this.json(version.signatureSlots),
          layout: this.json(version.layout),
          structureHash: createHash('sha256')
            .update(JSON.stringify(structure))
            .digest('hex'),
        },
      });
      const code = `RVT-${execution.occurrence.configuration.code}-${String(execution.occurrence.sequenceNumber).padStart(3, '0')}`;
      const documentSnapshot = {
        ...(execution.configurationSnapshot as Record<string, unknown>),
        performedAt: execution.performedAt,
        equipment: execution.equipment.map((x) => x.assetSnapshot),
        procedure: execution.procedureSnapshot,
        /**
         * O checklist do tipo de manutenção, como o técnico preencheu.
         *
         * É o que o item pedia: cada check marcado em campo aparece no
         * relatório final. Vai o roteiro **e** as respostas — só as respostas
         * seriam um mapa de chaves sem os rótulos que dão sentido a elas, e o
         * roteiro pode ter sido editado no catálogo desde a visita.
         */
        maintenanceChecklist: execution.checklistExecutions[0]
          ? {
              name: (
                execution.checklistExecutions[0].templateSnapshot as {
                  name?: string;
                }
              )?.name,
              version: execution.checklistExecutions[0].templateVersion,
              status: execution.checklistExecutions[0].status,
              progress: execution.checklistExecutions[0].progress,
              items: (
                execution.checklistExecutions[0].templateSnapshot as {
                  items?: { key: string; label: string }[];
                }
              )?.items,
              answers: execution.checklistExecutions[0].answers,
              completedAt: execution.checklistExecutions[0].completedAt,
            }
          : null,
        observations: execution.observations,
        recommendations: execution.recommendations,
        freeTextRecommendation: execution.freeTextRecommendation,
        evidence: execution.evidence,
        fieldTechnicianSignature: execution.fieldTechnicianSignature,
        technicalResponsibleSignature: execution.technicalResponsibleSignature,
        customerAcknowledgement: execution.customerAcknowledgement,
        rvtExecutionId: id,
      };
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
          context: this.json({
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

  private async resolveCalendar(
    tx: any,
    organizationId: string,
    businessUnitId: string,
    timezone: string,
  ) {
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

  private async createSchedulingProjection(tx: any, input: any) {
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
        location: this.json(input.location),
        metadata: this.json({ occurrenceId: input.occurrenceId }),
        allocations: input.responsibleUserId
          ? {
              create: {
                userId: input.responsibleUserId,
                resourceType: 'USER',
                role: 'FIELD_TECHNICIAN',
                status: 'ALLOCATED',
              },
            }
          : undefined,
      },
      update: {
        startsAt: input.startsAt,
        endsAt: new Date(input.startsAt.getTime() + 60 * 60_000),
        status: 'CONFIRMED',
        deletedAt: null,
        title: input.title,
        timezone: input.timezone,
        location: this.json(input.location),
      },
      select: { id: true },
    });
    return event.id;
  }

  private async assertScope(
    tx: any,
    organizationId: string,
    businessUnitId: string,
    customerId: string,
    equipmentIds: string[],
  ) {
    const [unit, customer, count] = await Promise.all([
      tx.businessUnit.findFirst({
        where: { id: businessUnitId, organizationId, deletedAt: null },
      }),
      tx.customer.findFirst({
        where: { id: customerId, organizationId, deletedAt: null },
      }),
      tx.asset.count({
        where: {
          id: { in: equipmentIds },
          organizationId,
          businessUnitId,
          customerId,
          deletedAt: null,
        },
      }),
    ]);
    if (!unit || !customer || count !== equipmentIds.length)
      throw new Error('BUSINESS_UNIT_SCOPE_INVALID');
  }
  private async assertMember(
    tx: any,
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
    tx: any,
    organizationId: string,
    businessUnitId: string,
    userId: string,
    role: string,
  ) {
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
    tx: any,
    organizationId: string,
    businessUnitId: string,
    userId: string,
    action: string,
    entityId: string,
    after: any,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        businessUnitId,
        userId,
        action,
        entityType: 'RVT',
        entityId,
        after: this.json(after),
      },
    });
  }
  private date(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  private json(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}
