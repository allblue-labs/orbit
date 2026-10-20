"use client";

/**
 * KPIs executivos — `GET /analytics/dashboard` (`metrics`).
 *
 * Cada indicador chega pronto do backend: valor, unidade, alvo, status,
 * direção, variação, origem e procedência. Toda a apresentação (rótulo,
 * ícone, cor, formato, favorabilidade e marca de procedência) vem do Metric
 * Registry — o componente não decide nada disso.
 */
import { StatCard } from "@/components/ui/stat-card";
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
import type { WidgetProps } from "./widget-registry";

export function ExecutiveKpisWidget({ widget, analytics }: WidgetProps) {
  return (
    <PanelFrame
      panelId={widget.id}
      title={widget.title}
      description={widget.description}
    >
      <PanelState
        query={analytics.dashboard}
        loadingRows={4}
        isEmpty={(data) => data.metrics.length === 0}
      >
        {(data) => (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {sortByPriority(data.metrics).map((metric) => (
              <KpiTile key={metric.id} metric={presentMetric(metric)} />
            ))}
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

function KpiTile({ metric }: { metric: PresentedMetric }) {
  const Icon = metric.icon;
  return (
    /*
      Altura igual entre vizinhos, e a faixa de situação no pé.

      A grade já estica os itens, mas o cartão dentro do contêiner esticado
      continuava com a altura do conteúdo: um rótulo que quebra em duas linhas
      deixava aquele cartão mais alto que os outros e a faixa de situação dele
      desalinhada das vizinhas. `flex-1` no cartão faz os quatro terminarem na mesma
      linha, e a faixa fica embaixo em todos.

      `labelLines={2}` completa o alinhamento por dentro: sem isso, os cartões ficam
      da mesma altura mas os **números** não, porque o rótulo de duas linhas empurra
      o valor para baixo só no cartão dele.
    */
    <div className="flex h-full flex-col gap-1.5">
      <StatCard
        className="flex-1"
        labelLines={2}
        label={metric.label}
        value={metric.value}
        delta={metric.change}
        trend={
          metric.trendTone === "positive"
            ? "up"
            : metric.trendTone === "negative"
              ? "down"
              : "neutral"
        }
        hint={metric.target ? `meta ${metric.target}` : undefined}
        icon={<Icon className={cn("size-4", metric.iconColor)} />}
      />
      <div className="flex flex-wrap items-center gap-1.5 px-1">
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[11px] font-medium",
            STATUS_CLASSES[metric.status],
          )}
        >
          {STATUS_LABELS[metric.status]}
        </span>
        <MetricProvenanceMark
          quality={metric.provenance.quality}
          mark={metric.provenance.mark}
          source={metric.provenance.source}
        />
      </div>
    </div>
  );
}
