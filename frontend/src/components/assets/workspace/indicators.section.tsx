"use client";

/**
 * Indicadores operacionais do ativo.
 *
 * ## De onde vêm os números
 *
 * **Não há analytics por ativo.** `AnalyticsQueryDto` aceita `from`, `to`,
 * `granularity` e `businessUnitId` — não `assetId`. Nenhum Read Model do
 * módulo Analytics é do equipamento.
 *
 * O que existe de verdade é a **contagem que o servidor faz** ao responder uma
 * consulta filtrada: `meta.total` de `GET /operations?assetId=…` e de
 * `GET /artifact-executions?assetId=…`. Esses números são contados no banco,
 * não somados aqui — a consulta pede `limit: 1` justamente porque só o total
 * interessa.
 *
 * ## Por que passam pelo Metric Registry
 *
 * O backend publica o número; rótulo, descrição, ícone, cor, formato e
 * procedência são apresentação, e apresentação de indicador tem um único dono
 * nesta base. As definições estão registradas em `metric-registry.ts` com os
 * mesmos ids usados aqui.
 *
 * ## O que **não** está aqui
 *
 * MTBF, disponibilidade, custo acumulado e tempo médio de reparo. São
 * indicadores legítimos de gestão de ativos e nenhum deles tem fonte: derivá-los
 * das listas seria cálculo de métrica no cliente, exatamente o que esta base
 * não faz.
 */
import { PanelFrame, PanelWithoutSource } from "@/components/panels";
import { MetricCard } from "@/workspace";
import {
  useAssetExecutionsCount,
  useAssetOperationsCount,
} from "@/hooks/assets/use-assets";

/** Ids registrados no Metric Registry para os contadores do ativo. */
const METRIC_IDS = {
  operations: "asset.operations.total",
  openOperations: "asset.operations.open",
  executions: "asset.artifact_executions.total",
} as const;

export function IndicatorsSection({ assetId }: { assetId: string }) {
  const operations = useAssetOperationsCount(assetId);
  const openOperations = useAssetOperationsCount(assetId, "IN_PROGRESS");
  const executions = useAssetExecutionsCount(assetId);

  return (
    <PanelFrame
      panelId="asset-indicators"
      title="Indicadores"
      description="Contagens deste equipamento"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard
          size="sm"
          showDescription
          metricId={METRIC_IDS.operations}
          value={operations.data?.meta.total}
          isPending={operations.isPending}
          failed={Boolean(operations.error)}
        />
        <MetricCard
          size="sm"
          showDescription
          metricId={METRIC_IDS.openOperations}
          value={openOperations.data?.meta.total}
          isPending={openOperations.isPending}
          failed={Boolean(openOperations.error)}
        />
        <MetricCard
          size="sm"
          showDescription
          metricId={METRIC_IDS.executions}
          value={executions.data?.meta.total}
          isPending={executions.isPending}
          failed={Boolean(executions.error)}
        />
      </div>

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        Indicadores de engenharia de manutenção — MTBF, disponibilidade e
        custo acumulado — ainda não estão disponíveis por equipamento.
      </p>
    </PanelFrame>
  );
}

/**
 * Saúde do ativo.
 *
 * `GET /analytics/health` existe, mas é da **organização ou da unidade** —
 * `AnalyticsQueryDto` não aceita `assetId`. Exibir aquele índice nesta tela
 * atribuiria ao equipamento um número que descreve a operação inteira.
 */
export function HealthSection() {
  return (
    <PanelFrame
      panelId="asset-health"
      title="Saúde do ativo"
      description="Índice de condição do equipamento"
    >
      <PanelWithoutSource reason="O índice de saúde disponível hoje é da organização ou da unidade. Não há índice por equipamento, e atribuir o da operação a este ativo seria enganoso." />
    </PanelFrame>
  );
}

/**
 * Histórico do ativo.
 *
 * O modelo `Asset` não tem tabela de eventos, e não há endpoint de auditoria.
 * Reconstruir a linha do tempo a partir das operações e execuções foi
 * explicitamente descartado: seria história montada no cliente, com risco de
 * divergir do que o servidor registra.
 */
export function HistorySection() {
  return (
    <PanelFrame
      panelId="asset-history"
      title="Histórico"
      description="Eventos do equipamento ao longo do tempo"
    >
      <PanelWithoutSource reason="A linha do tempo do equipamento ainda não está disponível. Os painéis de atendimentos, agenda e documentos mostram os registros vinculados a ele." />
    </PanelFrame>
  );
}

/**
 * Orbit Intelligence do ativo.
 *
 * Os três caminhos de IA existentes têm outro escopo:
 * `GET /analytics/intelligence` é da organização, `GET /ai-executions` filtra
 * por `operationId`, e os insights de artefato pertencem à execução. Nenhum
 * responde "o que a IA observou sobre este equipamento".
 */
export function IntelligenceSection() {
  return (
    <PanelFrame
      panelId="asset-intelligence"
      title="Orbit Intelligence"
      description="Alertas, recomendações, anomalias e tendências do ativo"
    >
      <PanelWithoutSource reason="A análise inteligente por equipamento ainda não está disponível. O que existe hoje tem escopo de organização ou de atendimento, e reaproveitá-lo aqui daria ao equipamento um número que não é dele." />
    </PanelFrame>
  );
}
