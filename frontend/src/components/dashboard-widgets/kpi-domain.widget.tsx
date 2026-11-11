"use client";

/**
 * Widgets de domínio — PMOC, equipamentos, SLA, técnicos e contratos.
 *
 * O backend resolve esses widgets por segmento (`hvac-*`), mas o Read Model
 * que ele associa a eles (`segment-metric`) é fixture. Os números reais
 * equivalentes existem no Analytics, classificados por `domain`: cada widget
 * aqui filtra os indicadores do seu domínio em `GET /analytics/dashboard`.
 *
 * Apresentação vem inteira do Metric Registry.
 */
import { cn } from "@/lib/utils";
import {
  MetricProvenanceMark,
  presentMetric,
  sortByPriority,
  STATUS_CLASSES,
  STATUS_LABELS,
  type PresentedMetric,
} from "@/metrics";
import { PanelFrame, PanelState } from "@/components/panels";
import type { AnalyticsDomain, AnalyticsKpi } from "@/types/dashboard";
import type { WidgetProps } from "./widget-registry";

export interface KpiDomainWidgetOptions {
  /** Domínio do Analytics que alimenta o widget. */
  domain: AnalyticsDomain;
  /** Restringe a indicadores específicos, quando o domínio é amplo. */
  indicatorIds?: readonly string[];
}

/**
 * Cria um widget ligado a um domínio do Analytics.
 *
 * Fábrica em vez de cinco componentes iguais: a diferença entre PMOC, SLA e
 * técnicos é só o recorte dos indicadores.
 */
export function createKpiDomainWidget(options: KpiDomainWidgetOptions) {
  const select = (metrics: readonly AnalyticsKpi[]): readonly AnalyticsKpi[] =>
    sortByPriority(
      metrics.filter(
        (metric) =>
          metric.domain === options.domain &&
          (!options.indicatorIds || options.indicatorIds.includes(metric.id)),
      ),
    );

  function KpiDomainWidget({ widget, analytics }: WidgetProps) {
    return (
      <PanelFrame
        panelId={widget.id}
        title={widget.title}
        description={widget.description}
      >
        <PanelState
          query={analytics.dashboard}
          loadingRows={2}
          emptyMessage="O Analytics não publica indicadores para este domínio no período."
          isEmpty={(data) => select(data.metrics).length === 0}
        >
          {(data) => (
            <ul className="space-y-4">
              {select(data.metrics).map((indicator) => (
                <IndicatorRow
                  key={indicator.id}
                  metric={presentMetric(indicator)}
                />
              ))}
            </ul>
          )}
        </PanelState>
      </PanelFrame>
    );
  }

  KpiDomainWidget.displayName = `KpiDomainWidget(${options.domain})`;
  return KpiDomainWidget;
}

function IndicatorRow({ metric }: { metric: PresentedMetric }) {
  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {metric.label}
        </span>
        <span className="font-display shrink-0 text-xl font-semibold">
          {metric.value}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
            metric.statusLabel
              ? "bg-muted text-muted-foreground"
              : STATUS_CLASSES[metric.status],
          )}
        >
          {metric.statusLabel ?? STATUS_LABELS[metric.status]}
        </span>
        {metric.change ? (
          <span className="text-[11px] text-muted-foreground">
            {metric.change}
          </span>
        ) : null}
        {metric.target ? (
          <span className="text-[11px] text-muted-foreground">
            meta {metric.target}
          </span>
        ) : null}
        <MetricProvenanceMark
          quality={metric.provenance.quality}
          mark={metric.provenance.mark}
          source={metric.provenance.source}
        />
      </div>
    </li>
  );
}
