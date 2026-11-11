"use client";

/** Same radar component, showing measured rates only; unknown samples never become zeros. */
import { useMemo } from "react";
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import {
  PanelChartFrame,
  PanelEmpty,
  PanelError,
  PanelLoading,
} from "@/components/panels";
import { resolveMetric } from "@/metrics";
import type { AnalyticsKpi } from "@/types/dashboard";
import type { WidgetProps } from "./widget-registry";

const CURRENT_COLOR = "var(--color-chart-1)";
const PREVIOUS_COLOR = "var(--color-chart-4)";

import { comparativeAxes, type RadarRow } from "./comparative-radar.model";

/** Contagens comparáveis — mostradas como número, nunca como eixo do radar. */
function comparableCounts(
  current: readonly AnalyticsKpi[],
  previous: readonly AnalyticsKpi[],
): ReadonlyArray<{
  id: string;
  label: string;
  current: string;
  previous: string;
}> {
  const before = new Map(previous.map((kpi) => [kpi.id, kpi.value]));

  return current
    .filter((kpi) =>
      ["operations.total", "operations.completed"].includes(kpi.id),
    )
    .map((kpi) => {
      const metric = resolveMetric(kpi);
      return {
        id: kpi.id,
        label: metric.label,
        current: metric.format(kpi.value),
        previous: before.has(kpi.id) ? metric.format(before.get(kpi.id)!) : "—",
      };
    });
}

export function ComparativeRadarWidget({ widget, comparison }: WidgetProps) {
  const { current, previous, windows } = comparison;

  const rows = useMemo(
    () =>
      current.data && previous.data
        ? comparativeAxes(current.data.indicators, previous.data.indicators)
        : [],
    [current.data, previous.data],
  );

  const counts = useMemo(
    () =>
      current.data && previous.data
        ? comparableCounts(current.data.indicators, previous.data.indicators)
        : [],
    [current.data, previous.data],
  );

  return (
    <PanelChartFrame
      panelId={widget.id}
      title={widget.title}
      description={`${windows.thisMonth.label} · ${windows.lastMonth.label}`}
      height={340}
    >
      <ComparisonState current={current} previous={previous} rows={rows}>
        <div className="flex h-full flex-col">
          <div className="min-h-0 min-w-0 flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={[...rows]} outerRadius="72%">
                <PolarGrid stroke="var(--color-border)" />
                <PolarAngleAxis
                  dataKey="axis"
                  tickSize={4}
                  tick={{
                    fontSize: 11,
                    fill: "var(--color-muted-foreground)",
                  }}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={{
                    fontSize: 10,
                    fill: "var(--color-muted-foreground)",
                  }}
                  axisLine={false}
                />
                {rows.length >= 3 &&
                rows.every((row) => row.previous !== null) ? (
                  <Radar
                    name={windows.lastMonth.label}
                    dataKey="previous"
                    stroke={PREVIOUS_COLOR}
                    fill={PREVIOUS_COLOR}
                    fillOpacity={0.15}
                  />
                ) : null}
                {rows.length >= 3 &&
                rows.every((row) => row.current !== null) ? (
                  <Radar
                    name={windows.thisMonth.label}
                    dataKey="current"
                    stroke={CURRENT_COLOR}
                    fill={CURRENT_COLOR}
                    fillOpacity={0.3}
                  />
                ) : null}
                <Legend wrapperStyle={{ fontSize: "0.7rem" }} />
                <Tooltip
                  labelFormatter={(label) =>
                    rows.find((row) => row.axis === label)?.label ?? label
                  }
                  formatter={(value: number | string) =>
                    value == null ? "Sem dados" : `${value}%`
                  }
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.75rem",
                    fontSize: "0.8125rem",
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {counts.length > 0 ? (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-xs">
              {counts.map((count) => (
                <li key={count.id} className="flex items-center gap-1.5">
                  <span className="text-muted-foreground">{count.label}</span>
                  <span className="font-medium tabular-nums">
                    {count.current}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    ({count.previous})
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="pt-1.5 text-[11px] text-muted-foreground">
            Percentuais de 0 a 100; quanto maior, melhor. Sem base de cálculo
            não equivale a zero. Agenda e equipe consideram as demandas criadas
            em cada período, conforme cadastro atual. Apenas séries com dados em
            todos os eixos exibidos são desenhadas.
          </p>
        </div>
      </ComparisonState>
    </PanelChartFrame>
  );
}

/**
 * Estado combinado das duas leituras.
 *
 * Uma falha em qualquer janela invalida a comparação inteira: meio radar
 * mostraria o mês corrente contra zero.
 */
function ComparisonState({
  current,
  previous,
  rows,
  children,
}: {
  current: WidgetProps["comparison"]["current"];
  previous: WidgetProps["comparison"]["previous"];
  rows: readonly RadarRow[];
  children: React.ReactNode;
}) {
  if (current.isPending || previous.isPending) return <PanelLoading rows={5} />;

  const error = current.error ?? previous.error;
  if (error) {
    return (
      <PanelError
        error={error}
        onRetry={() => {
          current.refetch();
          previous.refetch();
        }}
      />
    );
  }

  if (
    rows.filter((row) => row.current !== null).length < 3 &&
    rows.filter((row) => row.previous !== null).length < 3
  ) {
    return (
      <PanelEmpty message="Ainda não há três indicadores com base de cálculo para desenhar o radar. Os totais estão nos indicadores executivos." />
    );
  }

  return <>{children}</>;
}
