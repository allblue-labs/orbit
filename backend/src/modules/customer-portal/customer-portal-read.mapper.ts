import { Injectable } from '@nestjs/common';
import { evaluateCompliance, frequencyLabel } from '../pmoc/pmoc.domain';
import type {
  CustomerPortalDocumentAccessReadModel,
  CustomerPortalDocumentReadModel,
  CustomerPortalOperationDetailsReadModel,
  CustomerPortalOperationTimelineItemReadModel,
  CustomerPortalPageReadModel,
  CustomerPortalPmocDetailsReadModel,
  CustomerPortalRvtDetailsReadModel,
  CustomerPortalStatusReadModel,
} from './customer-portal.read-models';
import type {
  CustomerPortalAssetRecord,
  CustomerPortalDocumentRecord,
  CustomerPortalOperationRecord,
  CustomerPortalPmocRecord,
  CustomerPortalRepositoryPage,
  CustomerPortalRvtRecord,
} from './customer-portal-read.repository';

interface OperationDetailsRecord extends CustomerPortalOperationRecord {
  history: readonly {
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    createdAt: Date;
  }[];
}

interface PmocDetailsRecord extends CustomerPortalPmocRecord {
  executions: readonly {
    id: string;
    sequenceNumber: number;
    dueOn: Date;
    status: string;
    performedAt: Date | null;
    artifactExecution: {
      _count: { manifests: number };
    } | null;
  }[];
}

type RvtSummaryRecord = Omit<CustomerPortalRvtRecord, 'occurrences'> & {
  occurrences: readonly { scheduledFor: Date | null }[];
};

type RvtDetailsRecord = Omit<RvtSummaryRecord, 'occurrences'> & {
  occurrences: readonly {
    id: string;
    sequenceNumber: number;
    scheduledFor: Date | null;
    localScheduledDate: Date | null;
    status: string;
    execution: {
      artifactExecutionId: string | null;
      performedAt: Date | null;
    } | null;
  }[];
  documentExecutionIds: ReadonlySet<string>;
};

@Injectable()
export class CustomerPortalReadMapper {
  page<T, U>(
    page: CustomerPortalRepositoryPage<T>,
    map: (value: T) => U,
  ): CustomerPortalPageReadModel<U> {
    const totalPages = Math.ceil(page.total / page.limit);
    return {
      data: page.data.map(map),
      meta: {
        page: page.page,
        limit: page.limit,
        total: page.total,
        totalPages,
        hasNextPage: page.page < totalPages,
        hasPreviousPage: page.page > 1,
      },
    };
  }

  operation(value: CustomerPortalOperationRecord) {
    return {
      id: value.id,
      code: value.code,
      type: this.operationType(value.kind),
      title: value.title,
      status: this.operationStatus(value.status),
      scheduledStart: this.instant(value.scheduledStart),
      scheduledEnd: this.instant(value.scheduledEnd),
      completedAt: this.instant(value.completedAt),
      businessUnit: this.businessUnit(value.businessUnit),
      assets: value.assets.map((link) => ({
        id: link.asset.id,
        displayName: link.asset.name,
      })),
      responsibleTechnician: value.responsibleFieldTechnician
        ? { displayName: value.responsibleFieldTechnician.displayName }
        : null,
      location: this.location(value.location),
      documentAvailable: value._count.artifactExecutions > 0,
    };
  }

  operationDetails(
    value: OperationDetailsRecord,
  ): CustomerPortalOperationDetailsReadModel {
    return {
      ...this.operation(value),
      description: value.description,
      startedAt: this.instant(value.startedAt),
      timeline: value.history.map((entry) => this.timeline(entry)),
    };
  }

  asset(value: CustomerPortalAssetRecord) {
    return {
      id: value.id,
      displayName: value.name,
      category: this.humanize(value.category),
      manufacturer: value.manufacturer,
      model: value.model,
      serialNumber: value.serialNumber,
      identifier: value.identifier,
      location: value.location,
      status: this.assetStatus(value.status),
      businessUnit: this.businessUnit(value.businessUnit),
    };
  }

  assetDetails(value: CustomerPortalAssetRecord) {
    return {
      ...this.asset(value),
      installedOn: this.date(value.installationAt),
      warrantyUntil: this.date(value.warrantyUntil),
      related: {
        operations: value._count.operationLinks,
        pmocPlans: value._count.pmocCoverages,
        rvtConfigurations: value.rvtConfigurations,
        documents: value._count.artifactExecutions,
      },
    };
  }

  pmoc(value: CustomerPortalPmocRecord) {
    const compliance = evaluateCompliance({
      planStatus: value.status,
      nextDueOn: value.nextDueOn,
      dueSoonDays: value.dueSoonDays,
      today: new Date(),
    });
    return {
      id: value.id,
      code: value.code,
      name: value.name,
      status: this.pmocPlanStatus(value.status),
      compliance: this.pmocComplianceStatus(compliance.status),
      startsOn: this.date(value.startsOn)!,
      endsOn: this.date(value.endsOn),
      nextDueOn: this.date(value.nextDueOn),
      frequency: frequencyLabel({
        amount: value.frequencyAmount,
        unit: value.frequencyUnit as 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS',
      }),
      coveredAssets: value._count.coverages,
      businessUnit: this.businessUnit(value.businessUnit),
    };
  }

  pmocDetails(value: PmocDetailsRecord): CustomerPortalPmocDetailsReadModel {
    return {
      ...this.pmoc(value),
      cycles: value.executions.map((execution) => ({
        id: execution.id,
        sequence: execution.sequenceNumber,
        dueOn: this.date(execution.dueOn)!,
        status: this.pmocExecutionStatus(execution.status),
        performedAt: this.instant(execution.performedAt),
        documentAvailable:
          (execution.artifactExecution?._count.manifests ?? 0) > 0,
      })),
    };
  }

  rvt(value: RvtSummaryRecord) {
    return {
      id: value.id,
      code: value.code,
      name: value.name,
      /**
       * O rótulo do tipo, como a organização o nomeou.
       *
       * Era um `if` sobre dois valores fixos — semanal ou semestral. Com
       * mensal, trimestral e anual no catálogo, traduzir aqui produziria
       * "Visita semestral" para tudo que não fosse semanal.
       */
      visitType: value.maintenanceType?.label ?? 'Visita técnica',
      schedule:
        value.scheduleMode === 'ONE_TIME' ? 'Visita única' : 'Recorrente',
      status: this.rvtConfigurationStatus(value.status),
      coverageStart: this.date(value.coverageStart)!,
      coverageEnd: this.date(value.coverageEnd),
      timezone: value.timezone,
      plannedVisits: value._count.occurrences,
      completedVisits: value.completedVisits,
      nextVisitAt: this.instant(value.occurrences[0]?.scheduledFor ?? null),
    };
  }

  rvtDetails(value: RvtDetailsRecord): CustomerPortalRvtDetailsReadModel {
    return {
      ...this.rvt(value),
      visits: value.occurrences.map((occurrence) => ({
        id: occurrence.id,
        sequence: occurrence.sequenceNumber,
        scheduledAt: this.instant(occurrence.scheduledFor),
        localDate: this.date(occurrence.localScheduledDate),
        status: this.rvtVisitStatus(occurrence.status),
        performedAt: this.instant(occurrence.execution?.performedAt ?? null),
        documentAvailable: occurrence.execution?.artifactExecutionId
          ? value.documentExecutionIds.has(
              occurrence.execution.artifactExecutionId,
            )
          : false,
      })),
    };
  }

  document(
    value: CustomerPortalDocumentRecord,
  ): CustomerPortalDocumentReadModel {
    if (!value.file || !value.issuedAt) {
      throw new TypeError('Portal document query returned an unavailable file');
    }
    return {
      id: value.id,
      fileName: value.file.fileName,
      type: this.humanize(value.execution.snapshot.artifactType),
      source: value.execution.snapshot.templateName || value.execution.title,
      issuedAt: value.issuedAt.toISOString(),
      availability: { code: 'available', label: 'Disponível' },
      sizeBytes: this.safeSize(value.file.sizeBytes),
      mimeType: value.file.mimeType,
    };
  }

  documentAccess(value: {
    url: string;
    expiresAt: Date;
    method: 'GET' | 'PUT';
  }): CustomerPortalDocumentAccessReadModel {
    if (value.method !== 'GET') {
      throw new TypeError('Portal document access must be read-only');
    }
    return {
      url: value.url,
      expiresAt: value.expiresAt.toISOString(),
      method: 'GET',
    };
  }

  private timeline(
    value: OperationDetailsRecord['history'][number],
  ): CustomerPortalOperationTimelineItemReadModel {
    const status = value.toStatus
      ? this.operationStatus(value.toStatus).label
      : null;
    return {
      id: value.id,
      event: this.timelineEvent(value.action),
      description: status
        ? `Situação atualizada para ${status.toLocaleLowerCase('pt-BR')}`
        : 'Atendimento atualizado',
      occurredAt: value.createdAt.toISOString(),
    };
  }

  private businessUnit(value: {
    id: string;
    legalName: string;
    tradeName: string | null;
    timezone: string;
  }) {
    return {
      id: value.id,
      displayName: value.tradeName ?? value.legalName,
      timezone: value.timezone,
    };
  }

  private operationStatus(value: string): CustomerPortalStatusReadModel {
    return this.status(value, {
      OPEN: ['open', 'Aberto'],
      SCHEDULED: ['scheduled', 'Agendado'],
      IN_PROGRESS: ['inProgress', 'Em andamento'],
      PAUSED: ['paused', 'Pausado'],
      COMPLETED: ['completed', 'Concluído'],
      CANCELLED: ['cancelled', 'Cancelado'],
    });
  }

  private assetStatus(value: string): CustomerPortalStatusReadModel {
    return this.status(value, {
      ACTIVE: ['active', 'Ativo'],
      INACTIVE: ['inactive', 'Inativo'],
      MAINTENANCE: ['maintenance', 'Em manutenção'],
      RETIRED: ['retired', 'Desativado'],
    });
  }

  private pmocPlanStatus(value: string): CustomerPortalStatusReadModel {
    return this.status(value, {
      DRAFT: ['draft', 'Em preparação'],
      ACTIVE: ['active', 'Ativo'],
      SUSPENDED: ['suspended', 'Suspenso'],
      EXPIRED: ['expired', 'Encerrado'],
      CANCELLED: ['cancelled', 'Cancelado'],
    });
  }

  private pmocComplianceStatus(value: string): CustomerPortalStatusReadModel {
    return this.status(value, {
      UP_TO_DATE: ['upToDate', 'Em dia'],
      DUE_SOON: ['dueSoon', 'Próximo do vencimento'],
      OVERDUE: ['overdue', 'Atrasado'],
      NOT_APPLICABLE: ['notApplicable', 'Não aplicável'],
    });
  }

  private pmocExecutionStatus(value: string): CustomerPortalStatusReadModel {
    return this.status(value, {
      PENDING: ['scheduled', 'Programado'],
      SCHEDULED: ['scheduled', 'Agendado'],
      IN_PROGRESS: ['inProgress', 'Em andamento'],
      COMPLETED: ['completed', 'Concluído'],
      CANCELLED: ['cancelled', 'Cancelado'],
      OVERDUE: ['overdue', 'Atrasado'],
    });
  }

  private rvtConfigurationStatus(value: string): CustomerPortalStatusReadModel {
    return this.status(value, {
      ACTIVE: ['active', 'Ativo'],
      INACTIVE: ['inactive', 'Inativo'],
      COMPLETED: ['completed', 'Concluído'],
      CANCELLED: ['cancelled', 'Cancelado'],
    });
  }

  private rvtVisitStatus(value: string): CustomerPortalStatusReadModel {
    return this.status(value, {
      SCHEDULED: ['scheduled', 'Agendada'],
      IN_PROGRESS: ['inProgress', 'Em andamento'],
      COMPLETED: ['completed', 'Realizada'],
      CANCELLED: ['cancelled', 'Cancelada'],
      MISSED: ['missed', 'Não realizada'],
    });
  }

  private status(
    value: string,
    values: Readonly<Record<string, readonly [string, string]>>,
  ): CustomerPortalStatusReadModel {
    const mapped = values[value];
    return mapped
      ? { code: mapped[0], label: mapped[1] }
      : { code: 'unavailable', label: 'Indisponível' };
  }

  private operationType(value: string): string {
    return (
      {
        SERVICE_ORDER: 'Ordem de serviço',
        PMOC: 'Manutenção PMOC',
        RVT: 'Visita técnica',
        INSPECTION: 'Inspeção',
        MAINTENANCE: 'Manutenção',
      }[value] ?? this.humanize(value)
    );
  }

  private timelineEvent(value: string): string {
    if (value.includes('STATUS')) return 'Situação atualizada';
    if (value.includes('CREATED')) return 'Atendimento criado';
    if (value.includes('ASSIGNED')) return 'Equipe definida';
    if (value.includes('ATTACH')) return 'Arquivo adicionado';
    return 'Atendimento atualizado';
  }

  private location(value: unknown): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const item = value as Record<string, unknown>;
    const parts = [
      item.address,
      item.street,
      item.number,
      item.city,
      item.stateCode,
    ].filter((entry): entry is string =>
      Boolean(typeof entry === 'string' && entry.trim()),
    );
    return parts.length ? parts.join(', ') : null;
  }

  private humanize(value: string): string {
    const words = value
      .trim()
      .toLocaleLowerCase('pt-BR')
      .split(/[_-]+/)
      .filter(Boolean);
    if (!words.length) return 'Não informado';
    const result = words.join(' ');
    return result.charAt(0).toLocaleUpperCase('pt-BR') + result.slice(1);
  }

  private instant(value: Date | null | undefined): string | null {
    return value?.toISOString() ?? null;
  }

  private date(value: Date | null | undefined): string | null {
    return value?.toISOString().slice(0, 10) ?? null;
  }

  private safeSize(value: bigint): number {
    const result = Number(value);
    if (!Number.isSafeInteger(result)) {
      throw new TypeError('Portal document size is outside the public range');
    }
    return result;
  }
}
