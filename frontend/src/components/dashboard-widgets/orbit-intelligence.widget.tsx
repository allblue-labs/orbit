"use client";

/**
 * Orbit Intelligence — `GET /analytics/intelligence`.
 *
 * O backend publica um contexto estável e agnóstico de UI
 * (`OrbitIntelligenceAnalyticsContext`): prioridades, riscos, tendências,
 * projeções e indicadores ambientais. Nenhum insight é gerado aqui.
 *
 * Nota de contrato: este endpoint devolve o *contexto* para IA, não o Read
 * Model narrativo (`OrbitIntelligenceReadModel`, com `summary` e
 * `recommendations`), que só existe como fixture no `/dashboard`. Por isso o
 * widget apresenta os sinais estruturados, sem texto gerado.
 */
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AnalyticsDirection } from "@/types/dashboard";
import { metricLabel, STATUS_CLASSES, STATUS_LABELS } from "@/metrics";
import { formatConfidence } from "@/lib/formatters";
import type { WidgetProps } from "./widget-registry";
import { PanelFrame, PanelState } from "@/components/panels";

const DIRECTION_ICONS = {
  UP: ArrowUpRight,
  DOWN: ArrowDownRight,
  STABLE: ArrowRight,
} as const satisfies Record<
  AnalyticsDirection,
  React.ComponentType<{ className?: string }>
>;

export function OrbitIntelligenceWidget({ widget, analytics }: WidgetProps) {
  const healthScore = analytics.intelligence.data?.healthScore;

  return (
    <PanelFrame
      panelId={widget.id}
      title={widget.title}
      description={widget.description}
      actions={
        healthScore == null ? null : (
          <Badge variant="secondary">Saúde {Math.round(healthScore)}</Badge>
        )
      }
    >
      <PanelState
        query={analytics.intelligence}
        loadingRows={4}
        emptyMessage="Nenhum sinal relevante no período."
        isEmpty={(data) =>
          data.priorities.length === 0 &&
          data.risks.length === 0 &&
          data.trends.length === 0
        }
      >
        {(data) => (
          <div className="grid gap-6 lg:grid-cols-3">
            <section className="space-y-3">
              <SectionTitle>Prioridades</SectionTitle>
              {data.priorities.length === 0 ? (
                <EmptyNote>Nenhum indicador fora do saudável.</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {data.priorities.map((priority) => (
                    <li
                      key={priority.indicator}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {metricLabel(priority.indicator)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                          STATUS_CLASSES[priority.status],
                        )}
                      >
                        {STATUS_LABELS[priority.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle>Riscos</SectionTitle>
              {data.risks.length === 0 ? (
                <EmptyNote>Nenhum risco sinalizado.</EmptyNote>
              ) : (
                <ul className="space-y-2">
                  {data.risks.map((risk) => (
                    <li key={risk} className="flex items-start gap-2 text-sm">
                      <AlertTriangle
                        className="mt-0.5 size-3.5 shrink-0 text-warning"
                        aria-hidden
                      />
                      <span className="text-muted-foreground">{risk}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-3">
              <SectionTitle>Tendências e projeções</SectionTitle>
              <ul className="space-y-2">
                {data.trends.map((trend) => {
                  const Icon = DIRECTION_ICONS[trend.direction];
                  return (
                    <li
                      key={trend.id}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {metricLabel(trend.id)}
                      </span>
                      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Icon className="size-3.5" aria-hidden />
                        {trend.changePercent}%
                      </span>
                    </li>
                  );
                })}
              </ul>
              {data.forecasts.length > 0 ? (
                <ul className="space-y-1 border-t border-border pt-3">
                  {data.forecasts.map((forecast) => (
                    <li
                      key={forecast.id}
                      className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
                    >
                      <span className="min-w-0 truncate">
                        Projeção de {metricLabel(forecast.id).toLowerCase()}
                      </span>
                      <span className="shrink-0">
                        {forecast.nextValue} ·{" "}
                        {formatConfidence(forecast.confidence)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}
