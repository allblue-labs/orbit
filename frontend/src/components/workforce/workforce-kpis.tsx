"use client";

/**
 * Indicadores da equipe.
 *
 * ## Dois de origens diferentes, e a diferença importa
 *
 * - **`technicians.active` e `technicians.assignment_coverage`** vêm do
 *   **Analytics** — são indicadores de verdade, publicados pelo `KpiEngine`,
 *   com unidade, direção e procedência.
 * - **Pessoas e convites pendentes** são o `meta.total` da paginação: os dois
 *   endpoints passaram a paginar, então o total é uma contagem do banco, não o
 *   tamanho de uma lista carregada.
 *
 * ## O que não existe
 *
 * "Técnicos em campo agora" exigiria presença em tempo real, que nenhum
 * contrato publica. `technicians.active` conta quem está alocado na janela
 * consultada — é o mais próximo, e é o que a procedência do Analytics já
 * descreve.
 */
import {
  useAnalyticsKpis,
  useAnalyticsQuery,
} from "@/hooks/dashboard/use-dashboard";
import {
  useTeamInvitations,
  useTeamMembers,
} from "@/hooks/workforce/use-workforce";
import { formatMetricValue, resolveMetric } from "@/metrics";
import type { AnalyticsKpi } from "@/types/dashboard";
import { InvitationStatus } from "@/types/contracts";
import { MetricCard } from "@/workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Indicadores de técnico que o Analytics publica hoje. */
const ANALYTICS_METRIC_IDS = [
  "technicians.active",
  "technicians.assignment_coverage",
] as const;

export function WorkforceKpis() {
  /**
   * `limit: 1` porque só interessa o `meta.total`.
   *
   * Agora que os dois endpoints paginam, o total é **do servidor** — antes era
   * o tamanho da lista completa, que só era legítimo porque a resposta era a
   * coleção inteira. Trazer uma página inteira para contar seria desperdício.
   */
  const members = useTeamMembers({ page: 1, limit: 1 });
  const invitations = useTeamInvitations({
    status: InvitationStatus.PENDING,
    page: 1,
    limit: 1,
  });
  /**
   * Janela de 30 dias — a mesma faixa padrão do Dashboard.
   *
   * `technicians.active` conta quem esteve alocado **na janela consultada**;
   * o número não faz sentido sem um período, e o contrato exige `from`.
   */
  const analyticsQuery = useAnalyticsQuery("30D");
  const analytics = useAnalyticsKpis(analyticsQuery);

  /** `KpiReadModel` embrulha os indicadores em `indicators`. */
  const published = (analytics.data?.indicators ?? []).filter((kpi) =>
    ANALYTICS_METRIC_IDS.includes(
      kpi.id as (typeof ANALYTICS_METRIC_IDS)[number],
    ),
  );

  return (
    <div className="space-y-2">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          metricId="team.members.total"
          value={members.data?.meta.total}
          isPending={members.isPending}
          failed={Boolean(members.error)}
          showDescription
        />
        <MetricCard
          metricId="team.invitations.pending"
          value={invitations.data?.meta.total}
          isPending={invitations.isPending}
          failed={Boolean(invitations.error)}
          showDescription
        />

        {analytics.isPending
          ? ANALYTICS_METRIC_IDS.map((id) => (
              <Skeleton key={id} className="h-24 rounded-xl" />
            ))
          : published.map((kpi) => <AnalyticsCard key={kpi.id} kpi={kpi} />)}
      </div>

      <p className="text-xs text-muted-foreground">
        Técnicos ativos e cobertura de atribuição vêm do Analytics. Pessoas e
        convites são o total da listagem — nada é somado a partir de uma página.
      </p>
    </div>
  );
}

/**
 * Indicador do Analytics.
 *
 * Não usa `MetricCard` porque o valor já vem com unidade e procedência do
 * servidor: quem formata é o Metric Registry, sobre o contrato publicado, e o
 * cartão precisa exibir a unidade que veio.
 */
function AnalyticsCard({ kpi }: { kpi: AnalyticsKpi }) {
  const metric = resolveMetric({
    id: kpi.id,
    label: kpi.label,
    unit: kpi.unit,
  });
  const Icon = metric.icon;

  return (
    <div className="glass-panel space-y-2 rounded-xl p-4">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={cn("size-4", metric.color)} aria-hidden />
        {metric.label}
      </p>
      <p className="font-display text-2xl font-bold tabular-nums">
        {formatMetricValue(metric, kpi.value)}
      </p>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {metric.description}
      </p>
    </div>
  );
}
