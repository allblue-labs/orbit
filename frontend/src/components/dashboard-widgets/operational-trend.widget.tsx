"use client";

/**
 * Tendências operacionais — `GET /analytics/dashboard` (`series`, `forecasts`).
 *
 * As séries chegam bucketizadas pelo `TrendEngine` na granularidade que o
 * backend escolheu para o período. A projeção vem do `ForecastEngine`; o
 * frontend apenas a exibe com o método e a confiança declarados.
 *
 * Nota de contrato: o backend publica `operations.created`, `operations.completed`
 * e `pmoc.generated`. Não existe série de backlog — por isso o gráfico traz
 * apenas o que é observado, sem completar a composição visual anterior.
 */
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import type { AnalyticsForecast, AnalyticsTrend } from "@/types/dashboard";
import { formatConfidence } from "@/lib/formatters";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import type { WidgetProps } from "./widget-registry";
import { PanelChartFrame, PanelState } from "@/components/panels";

const SERIES_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
];

type ChartRow = Record<string, number | string>;

/**
 * Achata as séries em linhas por timestamp.
 *
 * Reorganização de forma, não cálculo: nenhum valor é somado ou estimado.
 */
function toRows(
  series: readonly AnalyticsTrend[],
  formatAxisDate: (timestamp: string) => string,
): ChartRow[] {
  const rows = new Map<string, ChartRow>();
  for (const item of series) {
    for (const point of item.points) {
      const row = rows.get(point.timestamp) ?? {
        timestamp: point.timestamp,
        label: formatAxisDate(point.timestamp),
      };
      row[item.id] = point.value;
      rows.set(point.timestamp, row);
    }
  }
  return [...rows.values()].sort((left, right) =>
    String(left.timestamp).localeCompare(String(right.timestamp)),
  );
}

export function OperationalTrendWidget({ widget, analytics }: WidgetProps) {
  const { formatAxisDate } = useDateFormatters();
  const forecasts = analytics.dashboard.data?.forecasts ?? [];

  return (
    <PanelChartFrame
      panelId={widget.id}
      title={widget.title}
      description={widget.description}
      height={320}
      actions={
        forecasts.length > 0 ? <ForecastSummary forecasts={forecasts} /> : null
      }
    >
      <PanelState
        query={analytics.dashboard}
        loadingRows={5}
        isEmpty={(data) =>
          data.series.every((item) => item.points.length === 0)
        }
      >
        {(data) => (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={toRows(data.series, formatAxisDate)}
              margin={{ top: 8, right: 8, bottom: 0, left: -18 }}
            >
              <defs>
                {data.series.map((item, index) => (
                  <linearGradient
                    key={item.id}
                    id={`orbit-trend-${item.id}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={SERIES_COLORS[index % SERIES_COLORS.length]}
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="100%"
                      stopColor={SERIES_COLORS[index % SERIES_COLORS.length]}
                      stopOpacity={0}
                    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border)"
                vertical={false}
              />
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "0.75rem",
                  fontSize: "0.8125rem",
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: "0.75rem" }}
                formatter={(value) =>
                  data.series.find((item) => item.id === value)?.label ?? value
                }
              />
              {data.series.map((item, index) => (
                <Area
                  key={item.id}
                  type="monotone"
                  dataKey={item.id}
                  stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                  fill={`url(#orbit-trend-${item.id})`}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </PanelState>
    </PanelChartFrame>
  );
}

/** Projeções do `ForecastEngine`, exibidas com método e confiança do backend. */
function ForecastSummary({
  forecasts,
}: {
  forecasts: readonly AnalyticsForecast[];
}) {
  return (
    <div className="flex max-w-md flex-wrap justify-end gap-1.5">
      {forecasts.map((forecast) => (
        <Badge key={forecast.id} variant="outline" className="gap-1.5">
          {forecast.label}
          <span className="font-mono opacity-70">
            {formatConfidence(forecast.confidence)}
          </span>
        </Badge>
      ))}
    </div>
  );
}
