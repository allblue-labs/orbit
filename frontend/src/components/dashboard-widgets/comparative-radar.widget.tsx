"use client";

/**
 * Radar comparativo — este mês × mesmo trecho do mês anterior.
 *
 * O desenho mostra a forma (onde a operação está mais fraca, e se o polígono
 * cresceu ou encolheu); a leitura ao lado diz os números — valor, base e
 * variação em pontos. Regras em `comparative-radar.model`.
 */
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

import {
  PanelEmpty,
  PanelError,
  PanelFrame,
  PanelLoading,
} from "@/components/panels";
import { cn } from "@/lib/utils";
import {
  radarDeltaText,
  radarRows,
  radarShape,
  radarSummary,
  type RadarRow,
  type RadarTrend,
} from "./comparative-radar.model";
import type { WidgetProps } from "./widget-registry";

const CURRENT_COLOR = "var(--color-chart-1)";
const PREVIOUS_COLOR = "var(--color-muted-foreground)";

const TOM: Record<RadarTrend, string> = {
  better: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  worse: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
  same: "bg-muted text-muted-foreground ring-border",
  none: "bg-muted text-muted-foreground ring-border",
};

export function ComparativeRadarWidget({ widget, comparison }: WidgetProps) {
  const { current, previous, windows } = comparison;
  const rows = useMemo(
    () =>
      current.data && previous.data
        ? radarRows(current.data.indicators, previous.data.indicators)
        : [],
    [current.data, previous.data],
  );
  const shape = radarShape(rows);
  const resumo = radarSummary(rows);

  return (
    <PanelFrame
      panelId={widget.id}
      title={widget.title}
      description={`${windows.thisMonth.label} contra ${windows.lastMonth.label}. Quanto mais para fora, melhor.`}
    >
      {current.isPending || previous.isPending ? (
        <PanelLoading rows={5} />
      ) : current.error || previous.error ? (
        <PanelError
          error={(current.error ?? previous.error)!}
          onRetry={() => {
            current.refetch();
            previous.refetch();
          }}
        />
      ) : rows.length === 0 ? (
        <PanelEmpty message="Ainda não há atendimentos nem manutenções nestes dois períodos para comparar." />
      ) : (
        <div className="space-y-3">
          {resumo ? <p className="text-sm font-medium">{resumo}</p> : null}
          <div className="space-y-3">
            {shape.axes.length > 0 ? (
              <div className="space-y-2">
                <div className="mx-auto h-[260px] w-full max-w-[420px] min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={shape.axes} outerRadius="66%" margin={{ top: 12, right: 48, bottom: 12, left: 48 }}>
                      <PolarGrid stroke="var(--color-border)" />
                      <PolarAngleAxis dataKey="axis" tick={<AxisTick rows={shape.axes} />} />
                      <PolarRadiusAxis domain={[0, 100]} tickCount={5} tick={false} axisLine={false} />
                      {shape.drawPrevious ? (
                        <Radar
                          name={windows.lastMonth.label}
                          dataKey="previous"
                          stroke={PREVIOUS_COLOR}
                          strokeDasharray="4 3"
                          strokeWidth={1.5}
                          fill={PREVIOUS_COLOR}
                          fillOpacity={0.08}
                          isAnimationActive={false}
                        />
                      ) : null}
                      <Radar
                        name={windows.thisMonth.label}
                        dataKey="current"
                        stroke={CURRENT_COLOR}
                        strokeWidth={2}
                        fill={CURRENT_COLOR}
                        fillOpacity={0.22}
                        dot={{ r: 3, fill: CURRENT_COLOR, strokeWidth: 0 }}
                        isAnimationActive={false}
                      />
                      <Tooltip
                        labelFormatter={(label) =>
                          shape.axes.find((row) => row.axis === label)?.label ?? label
                        }
                        formatter={(value) =>
                          value == null ? "Sem base" : `${value}%`
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
                <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-0.5 w-4 rounded-full" style={{ background: CURRENT_COLOR }} aria-hidden />
                    {windows.thisMonth.label}
                  </span>
                  {shape.drawPrevious ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden />
                      {windows.lastMonth.label}
                    </span>
                  ) : (
                    <span>Mês anterior sem base em todos os eixos.</span>
                  )}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                O desenho precisa de ao menos três indicadores com base neste
                mês. A leitura abaixo mostra o que já dá para comparar.
              </p>
            )}
            <ul className="divide-y divide-border border-t border-border">
              {rows.map((row) => (
                <Reading key={row.id} row={row} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </PanelFrame>
  );
}

function Reading({ row }: { row: RadarRow }) {
  const Icone =
    row.trend === "better" ? ArrowUpRight : row.trend === "worse" ? ArrowDownRight : Minus;
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block truncate text-sm leading-tight">{row.label}</span>
        <span className="block text-[11px] text-muted-foreground tabular-nums">
          {row.currentBasis ? `${row.currentBasis} neste mês` : row.current === null ? "sem base neste mês" : ""}
          {row.previous !== null ? ` · antes ${row.previous}%` : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="font-display text-base font-semibold tabular-nums">
          {row.current === null ? "—" : `${row.current}%`}
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset",
            TOM[row.trend],
          )}
        >
          <Icone className="size-3" aria-hidden />
          {radarDeltaText(row)}
        </span>
      </span>
    </li>
  );
}

/** Rótulo do eixo com o valor deste mês embaixo: o desenho já diz o número. */
function AxisTick(props: {
  rows: readonly RadarRow[];
  x?: number;
  y?: number;
  textAnchor?: "start" | "middle" | "end";
  payload?: { value: string };
}) {
  const { x = 0, y = 0, textAnchor = "middle", payload, rows } = props;
  const row = rows.find((item) => item.axis === payload?.value);
  return (
    <text x={x} y={y} textAnchor={textAnchor} dominantBaseline="central" fontSize={11}>
      <tspan x={x} dy="-0.45em" fill="var(--color-muted-foreground)">
        {payload?.value}
      </tspan>
      <tspan x={x} dy="1.2em" fill="var(--color-foreground)" fontWeight={600}>
        {row?.current == null ? "—" : `${row.current}%`}
      </tspan>
    </text>
  );
}
