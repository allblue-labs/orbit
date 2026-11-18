import { Injectable } from '@nestjs/common';
import type {
  RvtConfigurationReadModel,
  RvtOccurrenceReadModel,
  RvtExecutionReadModel,
  RvtMaintenanceTypeReadModel,
} from './rvt.read-models';
import { deriveRvtDueState, formatOccurrenceSequence } from './rvt.domain';
import type {
  RvtOccurrenceSource,
  RvtMaintenanceTypeSource,
  RvtConfigurationSource,
  RvtExecutionSource,
} from './rvt.persistence';
import { jsonObject } from './rvt-json';

@Injectable()
export class RvtMapper {
  occurrence(
    source: RvtOccurrenceSource,
    timezone: string,
  ): RvtOccurrenceReadModel {
    return {
      id: source.id,
      configurationId: source.configurationId,
      responsibleFieldTechnicianId: source.responsibleFieldTechnicianId ?? null,
      equipmentIds: source.equipmentIds ?? [],
      sequenceNumber: source.sequenceNumber,
      sequence: formatOccurrenceSequence(source.sequenceNumber),
      scheduledFor: source.scheduledFor?.toISOString() ?? null,
      localScheduledDate:
        source.localScheduledDate?.toISOString().slice(0, 10) ?? null,
      status: source.status,
      dueState: deriveRvtDueState(source.scheduledFor, timezone),
      executionId: source.execution?.id ?? null,
      allowedActions:
        source.status === 'SCHEDULED' && !source.execution
          ? ['VIEW', 'START']
          : ['VIEW'],
    } as const;
  }

  /**
   * O tipo de manutenção como o cliente o lê.
   *
   * A linha do Prisma traz `organizationId`, `deletedAt` e a relação com o nome
   * da coluna (`checklistTemplate`). Devolver a linha crua vazava o inquilino e
   * entregava um campo com nome diferente do contrato — e como o serviço
   * repassava o retorno do repositório, o compilador não tinha o que reclamar.
   */
  maintenanceType(
    source: RvtMaintenanceTypeSource,
  ): RvtMaintenanceTypeReadModel {
    return {
      id: source.id,
      key: source.key,
      label: source.label,
      intervalDays: source.intervalDays,
      intervalMonths: source.intervalMonths,
      checklist: source.checklistTemplate
        ? {
            id: source.checklistTemplate.id,
            name: source.checklistTemplate.name,
            version: source.checklistTemplate.version,
          }
        : null,
    } as const;
  }

  configuration(source: RvtConfigurationSource): RvtConfigurationReadModel {
    return {
      id: source.id,
      code: source.code,
      name: source.name,
      maintenanceType: source.maintenanceType
        ? this.maintenanceType(source.maintenanceType)
        : null,
      calendarId: source.calendarId ?? null,
      startTime:
        typeof source.startTime === 'string' ? source.startTime : '09:00',
      scheduleMode: source.scheduleMode,
      status: source.status,
      coverage: {
        start: source.coverageStart.toISOString().slice(0, 10),
        end: source.coverageEnd?.toISOString().slice(0, 10) ?? null,
      },
      timezone: source.timezone,
      businessUnit: {
        id: source.businessUnitId,
        name: source.businessUnitName,
      },
      customer: { id: source.customerId, name: source.customerName },
      serviceLocation: source.serviceLocation,
      recurrence: source.recurrence,
      procedure: source.procedure,
      technicalResponsible: source.technicalResponsible,
      defaultResponsibleFieldTechnician: source.fieldTechnician,
      requiresTechnicalResponsible: source.requiresTechnicalResponsible,
      equipment: source.equipment.map((asset) => ({
        ...this.equipment(asset),
        addedDuringExecution: false,
      })),
      occurrences: source.occurrences.map((item) =>
        this.occurrence(item, source.timezone),
      ),
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    };
  }

  execution(source: RvtExecutionSource): RvtExecutionReadModel {
    return {
      id: source.id,
      occurrenceId: source.occurrenceId,
      status: source.status,
      performedAt: source.performedAt?.toISOString() ?? null,
      startedAt: source.startedAt.toISOString(),
      completedAt: source.completedAt?.toISOString() ?? null,
      responsibleFieldTechnician: {
        id: source.responsibleFieldTechnicianId,
        name: source.fieldTechnicianName,
      },
      auxiliaryTechnicians: source.auxiliaryTechnicians ?? [],
      technicalResponsible: source.technicalResponsibleUserId
        ? {
            id: source.technicalResponsibleUserId,
            name: source.technicalResponsibleName,
          }
        : null,
      procedureSnapshot: source.procedureSnapshot,
      configurationSnapshot: source.configurationSnapshot,
      observations: source.observations,
      recommendations: source.recommendations,
      freeTextRecommendation: source.freeTextRecommendation,
      equipment: source.equipment.map((item) => {
        const asset = jsonObject(item.assetSnapshot);
        return {
          ...this.equipment({
            id: item.assetId,
            name: typeof asset.name === 'string' ? asset.name : '',
            category: typeof asset.category === 'string' ? asset.category : '',
            identifier:
              typeof asset.identifier === 'string' ? asset.identifier : null,
            serialNumber:
              typeof asset.serialNumber === 'string'
                ? asset.serialNumber
                : null,
          }),
          addedDuringExecution: item.addedDuringExecution,
        };
      }),
      evidence: source.evidence.map((item) => ({
        id: item.id,
        kind: item.kind,
        caption: item.caption,
        fileId: item.storageFileId,
        assetId: item.assetId,
      })),
      customerAcknowledgement: source.customerAcknowledgement,
      operation: source.operation,
      artifact: source.artifact,
      allowedActions:
        source.status === 'IN_PROGRESS'
          ? ['VIEW', 'EDIT', 'ADD_EQUIPMENT', 'ADD_EVIDENCE', 'COMPLETE']
          : [
              'VIEW',
              ...(source.artifact ? ['DOWNLOAD'] : ['GENERATE_ARTIFACT']),
            ],
    };
  }

  private equipment(source: {
    id: string;
    name: string;
    category: string;
    identifier: string | null;
    serialNumber: string | null;
  }) {
    return {
      id: source.id,
      name: source.name,
      category: source.category,
      identifier: source.identifier ?? null,
      serialNumber: source.serialNumber ?? null,
    };
  }
}
