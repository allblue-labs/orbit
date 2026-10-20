/**
 * Documentos e execuções — e o recorte de PMOC.
 *
 * ## O PMOC agora tem domínio próprio
 *
 * Quando esta PR foi escrita, "PMOC" no Orbit era só um tipo de artefato, e
 * este provider declarava a ausência: não havia como dizer o que estava
 * vencido, porque não havia plano com periodicidade nem cobertura de
 * equipamento.
 *
 * A PR-26 criou esse domínio. O relatório de PMOC passou a compor **planos,
 * conformidade e ciclos** — o que estava previsto, o que foi cumprido e o que
 * venceu —, e mantém a contagem de execuções de artefato do tipo PMOC como o
 * que ela sempre foi: a **evidência documental**, ao lado do fato operacional.
 *
 * Relatórios gerados antes disso continuam como estavam: o snapshot é imutável,
 * e nenhuma leitura o recompõe.
 */
import { Injectable } from '@nestjs/common';
import { PmocService } from '../../pmoc/pmoc.service';
import type {
  ReportSectionReadModel,
  ReportTableReadModel,
} from '../report.read-models';
import { ReportRepository } from '../report.repository';
import {
  count,
  percent,
  type ReportComposition,
  type ReportProvider,
  type ReportProviderContext,
} from './report.provider';

const SOURCE = 'artifact_executions';
const MANIFEST_SOURCE = 'artifact_manifests';
const PMOC_SOURCE = 'pmoc_plans+pmoc_executions';

@Injectable()
export class DocumentsReportProvider implements ReportProvider {
  readonly domain = 'DOCUMENTS';
  readonly requires = {
    capabilities: ['artifact_executions.read'],
    permissions: ['artifact_executions.read'],
  };

  constructor(
    private readonly repository: ReportRepository,
    private readonly pmoc: PmocService,
  ) {}

  compose(context: ReportProviderContext): Promise<ReportComposition> {
    return this.build(context, false);
  }

  /**
   * PMOC: o domínio primeiro, a evidência depois.
   *
   * A seção de planos e conformidade vem do `PmocService` — a mesma fonte que a
   * tela de PMOC usa, com a mesma régua de vencimento. Duplicar a conta aqui
   * faria o relatório discordar da tela sobre o que está vencido.
   */
  async composePmoc(
    context: ReportProviderContext,
  ): Promise<ReportComposition> {
    const [domain, documents] = await Promise.all([
      this.composePlans(context),
      this.build(context, true),
    ]);

    return {
      sections: [...domain.sections, ...documents.sections],
      sources: [...domain.sources, ...documents.sources],
    };
  }

  /** Planos, conformidade e execuções — o fato operacional. */
  private async composePlans(
    context: ReportProviderContext,
  ): Promise<ReportComposition> {
    const [summary, unidades] = await Promise.all([
      this.pmoc.compliance(
        {
          organizationId: context.scope.organizationId,
          actorId: 'report',
          permissions: ['pmoc.read'],
          businessUnitIds: [],
          /* Ator sintético de leitura: compõe relatório, nunca executa
             manutenção. Dono nenhum — e nada aqui pede a exceção do dono. */
          isOrganizationOwner: false,
        },
        {
          from: context.scope.from,
          to: context.scope.to,
          businessUnitId: context.scope.businessUnitId ?? undefined,
        },
      ),
      /**
       * As unidades atendidas, pelo mesmo ator de relatório.
       *
       * A conformidade conta planos; isto descreve o que é feito em cada
       * visita. Um PMOC que prova cobertura sem descrever serviço não prova o
       * que a norma pede.
       */
      this.pmoc.unitCoverage(
        {
          organizationId: context.scope.organizationId,
          actorId: 'report',
          permissions: ['pmoc.read'],
          businessUnitIds: [],
          /* Ator sintético de leitura: compõe relatório, nunca executa
             manutenção. Dono nenhum — e nada aqui pede a exceção do dono. */
          isOrganizationOwner: false,
        },
        { businessUnitId: context.scope.businessUnitId ?? undefined },
      ),
    ]);

    const sections: ReportSectionReadModel[] = [
      {
        id: 'pmoc.plans',
        title: 'Planos de manutenção',
        description:
          'Compromissos de manutenção vigentes e a situação de cada um.',
        metrics: [
          {
            id: 'pmoc.plans_active',
            label: 'Planos ativos',
            value: count(summary.plans.active),
            source: PMOC_SOURCE,
            provenance: 'OBSERVED',
          },
          {
            id: 'pmoc.equipment_covered',
            label: 'Equipamentos cobertos',
            value: count(summary.equipment.covered),
            source: PMOC_SOURCE,
            provenance: 'OBSERVED',
            note: 'Equipamentos distintos em planos ativos.',
          },
          {
            id: 'pmoc.up_to_date',
            label: 'Em dia',
            value: count(summary.compliance.upToDate),
            source: PMOC_SOURCE,
            provenance: 'DERIVED',
            note: 'Próximo vencimento além da antecedência configurada no plano.',
          },
          {
            id: 'pmoc.due_soon',
            label: 'Próximos do vencimento',
            value: count(summary.compliance.dueSoon),
            source: PMOC_SOURCE,
            provenance: 'DERIVED',
          },
          {
            id: 'pmoc.overdue',
            label: 'Vencidos',
            value: count(summary.compliance.overdue),
            source: PMOC_SOURCE,
            provenance: 'DERIVED',
            note: 'Vencimento anterior a hoje, pelo relógio do servidor.',
          },
          ...(summary.compliance.upToDateRate === null
            ? []
            : [
                {
                  id: 'pmoc.up_to_date_rate',
                  label: 'Planos em dia',
                  value: summary.compliance.upToDateRate,
                  unit: '%',
                  source: PMOC_SOURCE,
                  provenance: 'DERIVED' as const,
                  note: 'Em dia ÷ (em dia + próximos + vencidos), sobre planos ativos.',
                },
              ]),
        ],
        tables: [],
      },
      {
        id: 'pmoc.cycles',
        title: 'Execuções de manutenção',
        description: 'O que foi cumprido no período e o que está em aberto.',
        metrics: [
          {
            id: 'pmoc.completed_in_period',
            label: 'Manutenções concluídas no período',
            value: count(summary.executions.completedInPeriod),
            source: PMOC_SOURCE,
            provenance: 'OBSERVED',
            note: 'Contadas pela data em que a manutenção aconteceu.',
          },
          {
            id: 'pmoc.pending_cycles',
            label: 'Execuções em aberto',
            value: count(summary.executions.pending),
            source: PMOC_SOURCE,
            provenance: 'OBSERVED',
          },
          {
            id: 'pmoc.overdue_cycles',
            label: 'Execuções vencidas',
            value: count(summary.executions.overdue),
            source: PMOC_SOURCE,
            provenance: 'OBSERVED',
          },
        ],
        tables: [],
      },
      {
        id: 'pmoc.units',
        title: 'Unidades atendidas',
        description:
          'As partes do sistema que recebem manutenção nos planos ativos, e o roteiro de cada uma.',
        metrics: [
          {
            id: 'pmoc.units_served',
            label: 'Unidades em atendimento',
            value: count(unidades.length),
            source: PMOC_SOURCE,
            provenance: 'OBSERVED',
            note: 'Unidades distintas declaradas por planos ativos.',
          },
          {
            id: 'pmoc.units_without_checklist',
            label: 'Sem roteiro',
            value: count(
              unidades.filter((unidade) => unidade.checklistName === null)
                .length,
            ),
            source: PMOC_SOURCE,
            provenance: 'DERIVED',
            note: 'Unidade sem roteiro entra no relatório sem itens a descrever.',
          },
        ],
        tables: [
          {
            id: 'pmoc.units_table',
            title: 'Unidades e roteiros',
            columns: [
              { key: 'unit', label: 'Unidade' },
              { key: 'checklist', label: 'Roteiro' },
              { key: 'items', label: 'Itens', align: 'right' as const },
              { key: 'plans', label: 'Planos', align: 'right' as const },
            ],
            rows: unidades.map((unidade) => ({
              unit: unidade.name,
              checklist: unidade.checklistName ?? 'Sem roteiro',
              items: count(unidade.checklistItems),
              plans: count(unidade.plans),
            })),
            source: PMOC_SOURCE,
            provenance: 'OBSERVED' as const,
          },
        ],
      },
    ];

    return {
      sections,
      sources: [
        {
          domain: 'PMOC',
          source: PMOC_SOURCE,
          provenance: 'OBSERVED',
          included: true,
        },
      ],
    };
  }

  private async build(
    { scope }: ReportProviderContext,
    pmocOnly: boolean,
  ): Promise<ReportComposition> {
    const [rows, manifests] = await Promise.all([
      this.repository.executionTotals(scope, pmocOnly),
      this.repository.manifestTotals(scope, pmocOnly),
    ]);

    const total = rows.reduce((sum, row) => sum + Number(row.total), 0);
    const completed = rows
      .filter((row) => row.status === 'COMPLETED' || row.status === 'APPROVED')
      .reduce((sum, row) => sum + Number(row.total), 0);
    const completionRate = percent(completed, total);

    const byStatus = new Map<string, number>();
    for (const row of rows) {
      byStatus.set(
        row.status,
        (byStatus.get(row.status) ?? 0) + Number(row.total),
      );
    }

    const statusTable: ReportTableReadModel = {
      id: 'documents.by_status',
      title: 'Execuções por situação',
      columns: [
        { key: 'status', label: 'Situação' },
        { key: 'total', label: 'Execuções', align: 'right' },
      ],
      rows: [...byStatus.entries()].map(([status, value]) => ({
        status,
        total: count(value),
      })),
      source: SOURCE,
      provenance: 'OBSERVED',
    };

    const typeTable: ReportTableReadModel = {
      id: 'documents.by_type',
      title: 'Execuções por tipo de documento',
      columns: [
        { key: 'artifactType', label: 'Tipo' },
        { key: 'status', label: 'Situação' },
        { key: 'total', label: 'Execuções', align: 'right' },
      ],
      rows: rows.map((row) => ({
        artifactType: row.artifact_type,
        status: row.status,
        total: count(row.total),
      })),
      source: SOURCE,
      provenance: 'OBSERVED',
    };

    const sections: ReportSectionReadModel[] = [
      {
        id: pmocOnly ? 'pmoc.evidence' : 'documents.executions',
        title: pmocOnly
          ? 'Evidência documental de PMOC'
          : 'Execuções de artefato',
        description: pmocOnly
          ? 'Formulários de PMOC preenchidos no período e documentos emitidos. É a evidência do que as execuções acima registram.'
          : 'Iniciadas no período, pela data de criação.',
        metrics: [
          {
            id: 'documents.total',
            label: 'Execuções no período',
            value: count(total),
            source: SOURCE,
            provenance: 'OBSERVED',
          },
          {
            id: 'documents.completed',
            label: 'Concluídas ou aprovadas',
            value: count(completed),
            source: SOURCE,
            provenance: 'OBSERVED',
          },
          ...(completionRate === null
            ? []
            : [
                {
                  id: 'documents.completion_rate',
                  label: 'Taxa de conclusão',
                  value: completionRate,
                  unit: '%',
                  source: SOURCE,
                  provenance: 'DERIVED' as const,
                },
              ]),
          {
            id: 'documents.issued',
            label: 'Revisões emitidas',
            value: count(manifests?.issued),
            source: MANIFEST_SOURCE,
            provenance: 'OBSERVED',
            note: 'Documento oficial emitido — não conta rascunho nem revisão aberta.',
          },
          {
            id: 'documents.revoked',
            label: 'Revisões revogadas',
            value: count(manifests?.revoked),
            source: MANIFEST_SOURCE,
            provenance: 'OBSERVED',
          },
        ],
        tables: pmocOnly ? [statusTable] : [statusTable, typeTable],
        ...(pmocOnly
          ? {
              unavailableReason: undefined,
            }
          : {}),
      },
    ];

    return {
      sections,
      sources: [
        {
          domain: this.domain,
          source: SOURCE,
          provenance: 'OBSERVED',
          included: true,
        },
        {
          domain: this.domain,
          source: MANIFEST_SOURCE,
          provenance: 'OBSERVED',
          included: true,
        },
      ],
    };
  }
}
