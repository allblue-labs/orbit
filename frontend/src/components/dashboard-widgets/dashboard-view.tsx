"use client";

/**
 * Composição do Dashboard.
 *
 * Client Component porque o painel é interativo: faixa de período,
 * atualização automática por widget e gráficos. As leituras compartilhadas
 * são feitas **uma vez aqui** e distribuídas aos widgets — nenhum widget
 * repete a mesma consulta, e o cache do TanStack Query mantém a coerência.
 *
 * A ordem, o tamanho e a presença de cada widget vêm de `GET /dashboard`. O
 * frontend não decide o que aparece.
 */
import { useState } from "react";
import { RefreshCw } from "lucide-react";

import { ContentContainer } from "@/components/layout/page-primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useAgenda,
  useAnalyticsDashboard,
  useAnalyticsHealth,
  useAnalyticsQuery,
  useDashboardLayout,
  useEnvironmentalImpact,
  useMonthComparison,
  useOrbitIntelligence,
} from "@/hooks/dashboard/use-dashboard";
import { useSchedulingTimeZone } from "@/components/scheduling/use-scheduling-timezone";
import { useSession } from "@/providers/session-provider";
import { useActiveScope } from "@/providers/use-active-scope";
import { cn } from "@/lib/utils";
import {
  DASHBOARD_RANGES,
  DASHBOARD_RANGE_LABELS,
  type DashboardRangeKey,
} from "@/types/dashboard";
import { formatDateTime } from "@/lib/formatters";
import { PanelError, toPanelQuery } from "@/components/panels";
import { resolveWidgets, type WidgetDataSources } from "./widget-registry";
import { PRODUCT_CAPABILITY, PRODUCT_FEATURE } from "@/registry/product-access";
import { organizarPainel, type Colunas } from "./dashboard-layout";

export function DashboardView() {
  const [range, setRange] = useState<DashboardRangeKey>("30D");
  const session = useSession();
  const scope = useActiveScope();
  const analyticsQuery = useAnalyticsQuery(range);
  const canUseIntelligence = session.canUseProductFeature(
    PRODUCT_CAPABILITY.ORBIT_INTELLIGENCE,
    PRODUCT_FEATURE.ORBIT_INTELLIGENCE,
  );
  /**
   * Fuso da unidade ativa.
   *
   * As janelas de comparação começam no primeiro dia do mês **na unidade**;
   * em UTC a fronteira cairia três horas antes e jogaria o início do mês para
   * o mês anterior. O resolvedor é o mesmo da agenda — não há um segundo.
   */
  const { timeZone } = useSchedulingTimeZone();

  const layout = useDashboardLayout(range);
  const comparison = useMonthComparison(timeZone);

  /**
   * Leituras compartilhadas.
   *
   * `/analytics/dashboard` já traz KPIs, séries, projeções e indicadores
   * ambientais — por isso os widgets de KPI, tendência e domínio consomem
   * essa única consulta em vez de chamar `/analytics/kpis` e
   * `/analytics/trends` separadamente.
   */
  const sources: WidgetDataSources = {
    analytics: {
      query: analyticsQuery,
      dashboard: toPanelQuery(useAnalyticsDashboard(analyticsQuery)),
      health: toPanelQuery(useAnalyticsHealth(analyticsQuery)),
      intelligence: toPanelQuery(
        useOrbitIntelligence(analyticsQuery, canUseIntelligence),
      ),
      environmentalImpact: toPanelQuery(useEnvironmentalImpact()),
    },
    scheduling: {
      agenda: toPanelQuery(useAgenda()),
    },
    comparison: {
      current: toPanelQuery(comparison.current),
      previous: toPanelQuery(comparison.previous),
      windows: comparison.windows,
    },
  };

  const widgets = layout.data ? resolveWidgets(layout.data.layout.widgets) : [];

  /**
   * As seções do painel, e o componente de cada widget por id.
   *
   * O mapa existe para o `organizarPainel` poder trabalhar só com o widget —
   * a arrumação depende do tamanho, não do componente — sem obrigar a
   * renderização a procurar em lista a cada item.
   */
  const linhas = organizarPainel(widgets.map((item) => item.widget));
  const componentePorId = new Map(
    widgets.map((item) => [item.widget.id, item] as const),
  );

  const renderizar = (id: string) => {
    const item = componentePorId.get(id);
    if (!item) return null;
    const { widget, Component } = item;
    return <Component widget={widget} {...sources} />;
  };

  return (
    <ContentContainer size="wide" className="space-y-8">
      <header className="flex flex-col gap-5 border-b border-border pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{session.organization?.displayName ?? "—"}</span>
            {session.entitlements ? (
              <Badge variant="outline">{session.entitlements.planKey}</Badge>
            ) : null}
            {layout.data ? (
              <Badge variant="outline">{layout.data.context.segment}</Badge>
            ) : null}
            {scope.businessUnit ? (
              <Badge variant="secondary">
                {scope.businessUnit.tradeName ?? scope.businessUnit.legalName}
              </Badge>
            ) : null}
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">
            Visão geral
          </h1>
          {layout.data ? (
            <p className="text-sm text-muted-foreground">
              Atualizado em {formatDateTime(layout.data.generatedAt)}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <div
            className="flex rounded-lg border border-border p-0.5"
            role="group"
            aria-label="Período"
          >
            {DASHBOARD_RANGES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                aria-pressed={option === range}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  option === range
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {DASHBOARD_RANGE_LABELS[option]}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon"
            aria-label="Atualizar dashboard"
            onClick={() => {
              void layout.refetch();
              void sources.analytics.dashboard.refetch();
              void sources.analytics.health.refetch();
              if (canUseIntelligence)
                void sources.analytics.intelligence.refetch();
              void sources.scheduling.agenda.refetch();
              void sources.comparison.current.refetch();
              void sources.comparison.previous.refetch();
            }}
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </header>

      {layout.isPending ? (
        <LayoutSkeleton />
      ) : layout.error ? (
        <PanelError
          error={layout.error}
          onRetry={() => void layout.refetch()}
        />
      ) : widgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum widget disponível para o seu plano e permissões.
        </p>
      ) : (
        <div className="space-y-6">
          {linhas.map((linha, posicao) => (
            /*
              Uma linha da grade de doze colunas.

              `items-stretch` é o que alinha o par: os dois widgets são itens da
              **mesma** linha, então o mais alto define a altura e o outro
              acompanha. É assim que o Índice de Saúde termina onde a Saúde
              Financeira termina, inclusive depois de ela crescer com o gráfico, e
              sem ninguém medir conteúdo.

              A chave é a posição mais os ids: duas linhas nunca têm o mesmo
              conjunto, e `posicao` sozinha remontaria a subárvore quando um widget
              entrasse ou saísse no meio.
            */
            <div
              key={`${posicao}-${linha.widgets.map((item) => item.widget.id).join("+")}`}
              className="grid items-stretch gap-6 lg:grid-cols-12"
            >
              {linha.widgets.map((item) => (
                /*
                  `[&>*]:h-full` porque o contêiner esticar não estica o cartão
                  dentro dele. É seguro aqui **porque cada contêiner tem um filho
                  só**: num empilhamento, `h-full` em cada filho faria cada um medir
                  a altura do conjunto, e foi assim que uma página de painéis chegou
                  a quase dezenove mil pixels.
                */
                <div
                  key={item.widget.id}
                  className={cn("min-w-0 [&>*]:h-full", COLUNAS[item.colunas])}
                >
                  {renderizar(item.widget.id)}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </ContentContainer>
  );
}

/**
 * Quantas colunas, em classe do Tailwind.
 *
 * Um mapa, e não `lg:col-span-${n}`: o Tailwind varre o código em busca de nomes de
 * classe literais, e uma classe montada em tempo de execução não existe no CSS
 * gerado — o widget apareceria sempre com a largura padrão.
 */
const COLUNAS: Readonly<Record<Colunas, string>> = {
  4: "lg:col-span-4",
  6: "lg:col-span-6",
  8: "lg:col-span-8",
  12: "lg:col-span-12",
};

/** O esqueleto imita as primeiras linhas reais: 4+8, depois 12, depois 8+4. */
function LayoutSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {[
        "lg:col-span-4",
        "lg:col-span-8",
        "lg:col-span-12",
        "lg:col-span-8",
        "lg:col-span-4",
      ].map((span, index) => (
        <Skeleton key={index} className={cn("h-56 rounded-xl", span)} />
      ))}
    </div>
  );
}
