/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { deriveRvtDueState, formatOccurrenceSequence } from './rvt.domain';

@Injectable()
export class RvtMapper {
  occurrence(source: any, timezone: string) {
    return {
      id: source.id,
      configurationId: source.configurationId,
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
  maintenanceType(source: any) {
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

  configuration(source: any) {
    return {
      id: source.id,
      code: source.code,
      name: source.name,
      maintenanceType: source.maintenanceType
        ? this.maintenanceType(source.maintenanceType)
        : null,
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
      technicalResponsible: source.technicalResponsibleId
        ? {
            id: source.technicalResponsibleId,
            name: source.technicalResponsibleName,
          }
        : null,
      defaultResponsibleFieldTechnician: source.fieldTechnicianId
        ? { id: source.fieldTechnicianId, name: source.fieldTechnicianName }
        : null,
      requiresTechnicalResponsible: source.requiresTechnicalResponsible,
      equipment: (source.equipment ?? []).map((item: any) =>
        this.equipment(item.asset ?? item, false),
      ),
      occurrences: (source.occurrences ?? []).map((item: any) =>
        this.occurrence(item, source.timezone),
      ),
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    };
  }

  execution(source: any) {
    const operation = source.operationId
      ? {
          id: source.operationId,
          code: source.operationCode,
          status: source.operationStatus,
        }
      : null;
    const artifact = source.artifactExecutionId
      ? {
          id: source.artifactExecutionId,
          code: source.artifactCode,
          status: source.artifactStatus,
          renderStatus: source.artifactRenderStatus,
        }
      : null;
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
      equipment: (source.equipment ?? []).map((item: any) =>
        this.equipment(
          { ...item.assetSnapshot, id: item.assetId },
          item.addedDuringExecution,
        ),
      ),
      evidence: (source.evidence ?? []).map((item: any) => ({
        id: item.id,
        kind: item.kind,
        caption: item.caption,
        fileId: item.storageFileId,
        assetId: item.assetId,
      })),
      customerAcknowledgement: source.customerAcknowledgement,
      operation,
      artifact,
      allowedActions:
        source.status === 'IN_PROGRESS'
          ? ['VIEW', 'EDIT', 'ADD_EQUIPMENT', 'ADD_EVIDENCE', 'COMPLETE']
          : ['VIEW', ...(artifact ? ['DOWNLOAD'] : ['GENERATE_ARTIFACT'])],
    };
  }

  private equipment(source: any, addedDuringExecution: boolean) {
    return {
      id: source.id,
      name: source.name,
      category: source.category,
      identifier: source.identifier ?? null,
      serialNumber: source.serialNumber ?? null,
      addedDuringExecution,
    };
  }
}
