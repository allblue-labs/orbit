"use client";

/**
 * Widget Registry do frontend.
 *
 * Resolve `ResolvedDashboardWidget.id` — a tag estável que o backend devolve
 * em `GET /dashboard` — para o componente que sabe renderizá-la.
 *
 * **Autorização não mora aqui nem nos componentes visuais.** Quem decide o
 * que o tenant enxerga é o `WidgetResolver` do backend, que já filtra por
 * segmento, módulos do plano, plano, permissões e contexto de organização
 * antes de devolver a lista. O registry apenas escolhe o componente e, quando
 * não conhece a tag, ignora o widget com log em desenvolvimento.
 *
 * Nem todo widget resolvido tem fonte de dados real: o
 * `DashboardRepository.read()` do backend devolve fixtures fixas no código.
 * Os que não têm equivalente no Analytics são declarados como
 * `withoutSource`, e o painel diz isso em vez de exibir número inventado.
 */
import type { ComponentType } from "react";

import type { PanelQuery } from "@/components/panels";
import type { MonthComparison } from "@/lib/analytics/month-comparison";
import type {
  AgendaReadModel,
  AnalyticsDashboardReadModel,
  AnalyticsHealthReadModel,
  AnalyticsQuery,
  EnvironmentalImpactReadModel,
  KpiReadModel,
  OrbitIntelligenceAnalyticsContext,
  ResolvedDashboardWidget,
} from "@/types/dashboard";
import { AttentionCenterWidget } from "./attention-center.widget";
import { ComparativeRadarWidget } from "./comparative-radar.widget";
import { EnvironmentalWidget } from "./environmental.widget";
import { FinancialHealthWidget } from "./financial-health.widget";
import { ExecutiveKpisWidget } from "./executive-kpis.widget";
import { HealthScoreWidget } from "./health-score.widget";
import { createKpiDomainWidget } from "./kpi-domain.widget";
import { OperationalTrendWidget } from "./operational-trend.widget";
import { OrbitIntelligenceWidget } from "./orbit-intelligence.widget";
import { UpcomingEventsWidget } from "./upcoming-events.widget";
import { PanelFrame, PanelWithoutSource } from "@/components/panels";
import { warnUnknown } from "@/registry";

/** Leituras compartilhadas por todos os widgets do painel. */
export interface WidgetDataSources {
  analytics: {
    /**
     * O recorte que está valendo — período e unidade.
     *
     * Não é uma leitura; é o parâmetro que gerou as demais. Existe porque um
     * widget pode consultar uma fonte própria e precisa fazê-lo **no mesmo
     * recorte** do painel, em vez de escolher um período por conta.
     */
    query: AnalyticsQuery;
    dashboard: PanelQuery<AnalyticsDashboardReadModel>;
    health: PanelQuery<AnalyticsHealthReadModel>;
    intelligence: PanelQuery<OrbitIntelligenceAnalyticsContext>;
    environmentalImpact: PanelQuery<EnvironmentalImpactReadModel>;
  };
  scheduling: {
    agenda: PanelQuery<AgendaReadModel>;
  };
  /**
   * Comparação mês a mês.
   *
   * Duas leituras do mesmo endpoint de KPIs, uma por janela. Fica no conjunto
   * compartilhado — e não dentro do widget — para que o botão de atualizar do
   * painel também as renove, como faz com as demais fontes.
   */
  comparison: {
    current: PanelQuery<KpiReadModel>;
    previous: PanelQuery<KpiReadModel>;
    windows: MonthComparison;
  };
}

export interface WidgetProps extends WidgetDataSources {
  widget: ResolvedDashboardWidget;
}

export type WidgetComponent = ComponentType<WidgetProps>;

/** Colunas ocupadas na grade de 12 colunas, por tamanho do backend. */
export const WIDGET_SPAN: Readonly<
  Record<ResolvedDashboardWidget["size"], string>
> = {
  SMALL: "lg:col-span-3",
  MEDIUM: "lg:col-span-4",
  LARGE: "lg:col-span-8",
  FULL: "lg:col-span-12",
};

/**
 * Widgets que o painel resolve mas que ainda não têm dados reais.
 *
 * O motivo é exibido ao usuário — é informação honesta sobre o estado da
 * plataforma, não um erro. A frase fala do que falta no produto, não de como
 * o dado seria buscado.
 */
const WITHOUT_SOURCE: Readonly<Record<string, string>> = {
  "team-performance":
    "Produtividade por técnico ainda não é publicada pelo Analytics — apenas a contagem de técnicos alocados, no widget de técnicos.",
  "recent-activity":
    "O histórico de atividades existe por atendimento, ainda não consolidado para a organização.",
  "pharmacy-critical-stock":
    "Os indicadores ainda não cobrem estoque. Este quadro fica sem dados.",
  "pharmacy-expiring-products":
    "Os indicadores ainda não cobrem validade de produtos. Este quadro fica sem dados.",
  "pharmacy-lots":
    "Os indicadores ainda não cobrem lotes. Este quadro fica sem dados.",
  "pharmacy-purchases":
    "Os indicadores ainda não cobrem compras. Este quadro fica sem dados.",
  "pharmacy-dispensations":
    "Os indicadores ainda não cobrem dispensações. Este quadro fica sem dados.",
  "pharmacy-abc-curve":
    "Os indicadores ainda não cobrem curva ABC. Este quadro fica sem dados.",
  "agro-fields-overview":
    "Os indicadores ainda não cobrem áreas produtivas. Este quadro fica sem dados.",
  "agro-crop-status":
    "Os indicadores ainda não cobrem culturas. Este quadro fica sem dados.",
  "agro-machinery":
    "Os indicadores ainda não cobrem maquinário. Este quadro fica sem dados.",
  "agro-inputs":
    "Os indicadores ainda não cobrem insumos. Este quadro fica sem dados.",
  "agro-irrigation":
    "Os indicadores ainda não cobrem irrigação. Este quadro fica sem dados.",
  "agro-production-forecast":
    "As projeções do Analytics cobrem operações e PMOC, não produção agrícola.",
};

/**
 * Widget sem fonte real: mantém o card, declara a ausência.
 *
 * **O componente é memoizado por motivo, e isso não é otimização.** React
 * identifica um componente pela referência da função: uma fábrica que devolve
 * uma função nova a cada chamada faz o React ver um tipo diferente e
 * **desmontar e remontar** a subárvore inteira. Como `resolveWidgets` roda a
 * cada render do dashboard, o painel piscava a cada render — o cache é o que
 * torna o tipo estável.
 */
const withoutSourceCache = new Map<string, WidgetComponent>();

function createWithoutSourceWidget(reason: string): WidgetComponent {
  const cached = withoutSourceCache.get(reason);
  if (cached) return cached;

  function WithoutSourceWidget({ widget }: WidgetProps) {
    return (
      <PanelFrame
        panelId={widget.id}
        title={widget.title}
        description={widget.description}
      >
        <PanelWithoutSource reason={reason} />
      </PanelFrame>
    );
  }
  WithoutSourceWidget.displayName = "WithoutSourceWidget";
  withoutSourceCache.set(reason, WithoutSourceWidget);
  return WithoutSourceWidget;
}

/**
 * Tag estável do backend → componente.
 *
 * Widgets de domínio reaproveitam a mesma fábrica, mudando só o recorte de
 * indicadores do Analytics.
 */
const REGISTRY: Readonly<Record<string, WidgetComponent>> = {
  "attention-center": AttentionCenterWidget,
  /**
   * Saúde Financeira.
   *
   * Estava em `WITHOUT_SOURCE` até a PR-21 do backend, que criou o domínio.
   * Agora consome `/financial/analytics/*` — e guarda a leitura atrás da
   * capability financeira, que é independente das operacionais.
   */
  "financial-health": FinancialHealthWidget,
  "operations-comparative-radar": ComparativeRadarWidget,
  "executive-kpis": ExecutiveKpisWidget,
  "health-score": HealthScoreWidget,
  "operational-trend": OperationalTrendWidget,
  "orbit-intelligence": OrbitIntelligenceWidget,
  "upcoming-events": UpcomingEventsWidget,
  "weather-environmental-intelligence": EnvironmentalWidget,
  "hvac-pmoc-status": createKpiDomainWidget({ domain: "PMOC" }),
  "hvac-equipment-health": createKpiDomainWidget({ domain: "EQUIPMENT" }),
  "hvac-sla": createKpiDomainWidget({
    domain: "OPERATIONS",
    indicatorIds: ["operations.sla_compliance", "operations.completion_rate"],
  }),
  "hvac-technicians": createKpiDomainWidget({ domain: "TECHNICIANS" }),
  "hvac-contracts": createKpiDomainWidget({ domain: "CONTRACTS" }),
};

/**
 * Resolve o componente de um widget.
 *
 * `null` significa "ignore este widget": tag desconhecida. Em
 * desenvolvimento, o motivo aparece no console uma vez por tag — pelo
 * `warnUnknown` do Registry Kernel, o mesmo dos demais registries — e em
 * produção o painel simplesmente segue sem ele.
 *
 * Este registry **não usa `createRegistry`**: os outros sempre devolvem algo
 * exibível, e aqui a ausência é a resposta certa. Widget desconhecido não vira
 * card genérico; ele some, porque um card vazio ocuparia espaço do painel sem
 * dizer nada. O que se compartilha é o aviso.
 */
export function resolveWidget(
  widget: ResolvedDashboardWidget,
): WidgetComponent | null {
  const known = REGISTRY[widget.id];
  if (known) return known;

  const reason = WITHOUT_SOURCE[widget.id];
  if (reason) return createWithoutSourceWidget(reason);

  warnUnknown(
    "dashboard",
    `widget (${widget.readModel})`,
    widget.id,
    "src/components/dashboard-widgets/widget-registry.tsx",
  );
  return null;
}

/** Widgets que o frontend sabe renderizar, na ordem definida pelo backend. */
export function resolveWidgets(
  widgets: readonly ResolvedDashboardWidget[],
): ReadonlyArray<{
  widget: ResolvedDashboardWidget;
  Component: WidgetComponent;
}> {
  return widgets.flatMap((widget) => {
    const Component = resolveWidget(widget);
    return Component ? [{ widget, Component }] : [];
  });
}
