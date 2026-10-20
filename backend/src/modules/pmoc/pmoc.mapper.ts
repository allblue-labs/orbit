/**
 * Mapeadores do domínio PMOC.
 *
 * Nenhum modelo Prisma sai daqui. A conformidade é **calculada no mapper**, com
 * o relógio do servidor, e viaja pronta: o cliente não recebe `nextDueOn` para
 * decidir sozinho se está vencido — receberia a régua junto, e duas telas
 * poderiam discordar.
 */
import { Injectable } from '@nestjs/common';
import {
  PLAN_TRANSITIONS,
  evaluateCompliance,
  frequencyLabel,
  toDateOnly,
  type FrequencyUnit,
  type PlanStatus,
} from './pmoc.domain';
import type {
  PmocComplianceReadModel,
  PmocCoverageReadModel,
  PmocPlanUnitReadModel,
  PmocUnitReadModel,
  PmocExecutionReadModel,
  PmocEquipmentExecutionReadModel,
  PmocPlanReadModel,
  PmocPlanSummaryReadModel,
} from './pmoc.read-models';
import type {
  CoverageRecord,
  ExecutionRecord,
  EquipmentExecutionRecord,
  PlanRecord,
  PlanUnitRecord,
} from './pmoc.repository';

@Injectable()
export class PmocMapper {
  summary(source: PlanRecord, now = new Date()): PmocPlanSummaryReadModel {
    return {
      id: source.id,
      code: source.code,
      name: source.name,
      status: source.status,
      validity: {
        startsOn: toDateOnly(source.startsOn),
        endsOn: source.endsOn ? toDateOnly(source.endsOn) : null,
      },
      frequency: {
        amount: source.frequencyAmount,
        unit: source.frequencyUnit as FrequencyUnit,
        label: frequencyLabel({
          amount: source.frequencyAmount,
          unit: source.frequencyUnit as FrequencyUnit,
        }),
      },
      compliance: this.compliance(source, now),
      businessUnit: {
        id: source.businessUnit.id,
        name: source.businessUnit.tradeName ?? source.businessUnit.legalName,
      },
      customer: {
        id: source.customer.id,
        name: source.customer.tradeName ?? source.customer.legalName,
      },
      technician: source.technician
        ? {
            id: source.technician.id,
            displayName: source.technician.displayName,
          }
        : null,
      technicalResponsible: source.technicalResponsible,
      /* Derivado do status, e não guardado: a máquina de estados é do domínio, e
         publicá-la pronta evita a listagem reconstruir a regra. */
      allowedTransitions: PLAN_TRANSITIONS[source.status as PlanStatus] ?? [],
      coveredEquipment: source._count.coverages,
      createdAt: source.createdAt.toISOString(),
      updatedAt: source.updatedAt.toISOString(),
    };
  }

  details(
    source: PlanRecord,
    extras: {
      coverages: readonly CoverageRecord[];
      units: readonly PlanUnitRecord[];
      currentExecution: ExecutionRecord | null;
      recentExecutions: readonly ExecutionRecord[];
    },
    now = new Date(),
  ): PmocPlanReadModel {
    return {
      ...this.summary(source, now),
      notes: source.notes,
      configuration: {
        serviceLocation: source.serviceLocation,
        scope: source.scope,
        serviceTypes: source.serviceTypes,
        procedure: source.procedure,
        schedulingPaused: source.schedulingPaused,
        reviewRequired: source.reviewRequired,
      },
      activatedAt: source.activatedAt?.toISOString() ?? null,
      createdBy: {
        id: source.createdBy.id,
        displayName: source.createdBy.displayName,
      },
      coverages: extras.coverages.map((coverage) => this.coverage(coverage)),
      units: extras.units.map((unit) => this.unit(unit)),
      currentExecution: extras.currentExecution
        ? this.execution(extras.currentExecution)
        : null,
      recentExecutions: extras.recentExecutions.map((execution) =>
        this.execution(execution),
      ),
      /** O que **este** plano aceita agora — a máquina de estados, publicada. */
    };
  }

  compliance(source: PlanRecord, now = new Date()): PmocComplianceReadModel {
    const evaluated = evaluateCompliance({
      planStatus: source.status,
      nextDueOn: source.nextDueOn,
      dueSoonDays: source.dueSoonDays,
      today: now,
    });

    return {
      status: evaluated.status,
      daysUntilDue: evaluated.daysUntilDue,
      overdue: evaluated.overdue,
      dueSoonDays: source.dueSoonDays,
      lastExecutedAt: source.lastExecutedAt?.toISOString() ?? null,
      nextDueOn: source.nextDueOn ? toDateOnly(source.nextDueOn) : null,
      /** O instante da avaliação — deixa explícito que é do servidor. */
      evaluatedAt: now.toISOString(),
    };
  }

  /**
   * Uma unidade, com o roteiro achatado em `checklist`.
   *
   * Os itens vêm do `Json` do modelo e podem ser qualquer coisa — o modelo foi
   * gravado por outra tela, em outra versão. Por isso a leitura filtra o que
   * não tem `key` e `label` em vez de publicar forma que o consumidor não
   * consegue renderizar.
   */
  unit(source: PlanUnitRecord): PmocPlanUnitReadModel {
    const roteiro = source.checklistTemplate;
    return {
      id: source.id,
      key: source.key,
      name: source.name,
      description: source.description,
      checklist: roteiro
        ? {
            id: roteiro.id,
            name: roteiro.name,
            items: this.checklistItems(roteiro.items),
          }
        : null,
    };
  }

  /** A unidade como cadastro: o que o plano declara, mais o estado no catálogo. */
  unitEntry(source: PlanUnitRecord): PmocUnitReadModel {
    return {
      ...this.unit(source),
      sortOrder: source.sortOrder,
      isActive: source.isActive,
    };
  }

  private checklistItems(
    source: unknown,
  ): readonly { key: string; label: string }[] {
    if (!Array.isArray(source)) return [];
    return source.flatMap((item) => {
      if (typeof item !== 'object' || item === null) return [];
      const record = item as Record<string, unknown>;
      return typeof record.key === 'string' && typeof record.label === 'string'
        ? [{ key: record.key, label: record.label }]
        : [];
    });
  }

  coverage(source: CoverageRecord): PmocCoverageReadModel {
    return {
      id: source.id,
      startsOn: toDateOnly(source.startsOn),
      endsOn: source.endsOn ? toDateOnly(source.endsOn) : null,
      notes: source.notes,
      asset: {
        id: source.asset.id,
        name: source.asset.name,
        category: source.asset.category,
        identifier: source.asset.identifier,
        serialNumber: source.asset.serialNumber,
        status: source.asset.status,
      },
    };
  }

  execution(source: ExecutionRecord): PmocExecutionReadModel {
    return {
      id: source.id,
      sequenceNumber: source.sequenceNumber,
      dueOn: toDateOnly(source.dueOn),
      status: source.status,
      performedAt: source.performedAt?.toISOString() ?? null,
      notes: source.notes,
      completedBy: source.completedBy
        ? {
            id: source.completedBy.id,
            displayName: source.completedBy.displayName,
          }
        : null,
      operation: source.operation
        ? {
            id: source.operation.id,
            code: source.operation.code,
            status: source.operation.status,
          }
        : null,
      artifactExecution: source.artifactExecution
        ? {
            id: source.artifactExecution.id,
            code: source.artifactExecution.code,
            status: source.artifactExecution.status,
          }
        : null,
      schedulingEventId: source.schedulingEventId,
      createdAt: source.createdAt.toISOString(),
    };
  }

  equipmentExecution(
    source: EquipmentExecutionRecord,
  ): PmocEquipmentExecutionReadModel {
    return {
      id: source.id,
      status: source.status,
      sequenceNumber: source.sequenceNumber,
      performedAt: source.performedAt?.toISOString() ?? null,
      startedAt: source.startedAt.toISOString(),
      completedAt: source.completedAt?.toISOString() ?? null,
      notes: source.notes,
      asset: source.asset,
      responsibleFieldTechnician: source.responsibleFieldTechnician,
      auxiliaryTechnicians:
        source.operation?.auxiliaryTechnicians.map((item) => item.user) ?? [],
      operation: source.operation
        ? {
            id: source.operation.id,
            code: source.operation.code,
            status: source.operation.status,
          }
        : null,
      artifactExecution: source.artifactExecution,
      evidence: source.evidence.map((item) => ({
        id: item.id,
        kind: item.kind,
        caption: item.caption,
        createdAt: item.createdAt.toISOString(),
        file: {
          ...item.storageFile,
          sizeBytes: item.storageFile.sizeBytes.toString(),
        },
      })),
    };
  }
}
