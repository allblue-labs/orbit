"use client";

/**
 * Radar comparativo — mês corrente contra o mês anterior.
 *
 * ## De onde vêm os números
 *
 * De **duas leituras de `GET /analytics/kpis`**, uma por janela. Nenhum valor
 * é calculado, normalizado ou interpolado aqui: o backend conta e classifica
 * cada indicador para o período que recebeu, e o gráfico desenha o que voltou.
 *
 * Não se usa o `changePercent` do próprio contrato para reconstruir o mês
 * anterior — isso seria o frontend inferindo um número que ninguém publicou.
 * Perguntar duas vezes custa uma requisição e devolve a verdade.
 *
 * ## Quais eixos entram
 *
 * Só indicadores **percentuais e comparáveis** (`comparable` no Metric
 * Registry). Duas razões:
 *
 * 1. um radar exige eixos na mesma escala — misturar "12 operações" com "87%"
 *    desenharia uma forma sem significado;
 * 2. nem todo indicador do Analytics responde ao período. Disponibilidade dos
 *    equipamentos e contratos ativos são contados sem recorte de data, então
 *    apareceriam idênticos nos dois meses e sugeririam estabilidade medida.
 *
 * As contagens comparáveis aparecem embaixo, como números — não como eixo.
 *
 * ## O que o backend não publica
 *
 * Ordens de serviço, visitas técnicas e PMOCs **por tipo de operação** não são
 * indicadores do Analytics: o `KpiEngine` não segmenta por `OperationKind`.
 * Produtividade por técnico também não — é a mesma ausência que já deixa o
 * widget "Desempenho da Equipe" sem fonte. Ausências declaradas no rodapé.
 */
import { useMemo, useState } from "react";
import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Text,
  Tooltip,
} from "recharts";

import {
  PanelChartFrame,
  PanelEmpty,
  PanelError,
  PanelLoading,
} from "@/components/panels";
import { getMetric, resolveMetric } from "@/metrics";
import type { AnalyticsKpi } from "@/types/dashboard";
import type { WidgetProps } from "./widget-registry";

const CURRENT_COLOR = "var(--color-chart-1)";
const PREVIOUS_COLOR = "var(--color-chart-4)";

/** Indicadores pedidos no painel que o Analytics não publica. */
const NOT_PUBLISHED = [
  "ordens de serviço por tipo",
  "visitas técnicas",
  "produtividade por técnico",
];

interface RadarRow {
  readonly axis: string;
  readonly current: number;
  readonly previous: number;
}

/** Indicador percentual e comparável, na ordem do Metric Registry. */
function comparableAxes(
  current: readonly AnalyticsKpi[],
  previous: readonly AnalyticsKpi[],
): readonly RadarRow[] {
  const before = new Map(previous.map((kpi) => [kpi.id, kpi.value]));

  return current
    .filter((kpi) => getMetric(kpi.id)?.comparable && kpi.unit === "%")
    .map((kpi) => ({
      axis: resolveMetric(kpi).label,
      current: kpi.value,
      previous: before.get(kpi.id) ?? 0,
    }));
}

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
    .filter((kpi) => getMetric(kpi.id)?.comparable && kpi.unit !== "%")
    .map((kpi) => {
      const metric = resolveMetric(kpi);
      return {
        id: kpi.id,
        label: metric.label,
        current: metric.format(kpi.value),
        previous: metric.format(before.get(kpi.id) ?? 0),
      };
    });
}

export function ComparativeRadarWidget({ widget, comparison }: WidgetProps) {
  const { current, previous, windows } = comparison;
  const [chartWidth, setChartWidth] = useState(0);
  const labelWidth = Math.max(64, Math.min(112, chartWidth * 0.35));

  const rows = useMemo(
    () =>
      current.data && previous.data
        ? comparableAxes(current.data.indicators, previous.data.indicators)
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
      height={400}
    >
      <ComparisonState current={current} previous={previous} rows={rows}>
        <div className="flex h-full flex-col">
          <div className="min-h-0 min-w-0 flex-1">
            <ResponsiveContainer
              width="100%"
              height="100%"
              onResize={(width) => setChartWidth(width)}
            >
              <RadarChart data={[...rows]} outerRadius="56%">
                <PolarGrid stroke="var(--color-border)" />
                <PolarAngleAxis
                  dataKey="axis"
                  tickSize={4}
                  tick={<RadarAxisLabel maxWidth={labelWidth} />}
                />
                <PolarRadiusAxis
                  domain={[0, 100]}
                  tick={{
                    fontSize: 10,
                    fill: "var(--color-muted-foreground)",
                  }}
                  axisLine={false}
                />
                <Radar
                  name={windows.lastMonth.label}
                  dataKey="previous"
                  stroke={PREVIOUS_COLOR}
                  fill={PREVIOUS_COLOR}
                  fillOpacity={0.15}
                />
                <Radar
                  name={windows.thisMonth.label}
                  dataKey="current"
                  stroke={CURRENT_COLOR}
                  fill={CURRENT_COLOR}
                  fillOpacity={0.3}
                />
                <Legend wrapperStyle={{ fontSize: "0.7rem" }} />
                <Tooltip
                  formatter={(value: number | string) => `${value}%`}
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
            Sem eixo para {NOT_PUBLISHED.join(", ")} — o Analytics não os
            publica.
          </p>
        </div>
      </ComparisonState>
    </PanelChartFrame>
  );
}

/** Wrap full axis names within the card instead of clipping a single line. */
function RadarAxisLabel({
  x = 0,
  y = 0,
  cy = 0,
  payload,
  maxWidth,
}: {
  x?: number;
  y?: number;
  cy?: number;
  payload?: { value: string | number };
  maxWidth: number;
}) {
  if (!payload) return <g />;
  const label = String(payload.value);
  return (
    <g aria-label={label}>
      <Text
        x={x}
        y={y}
        width={maxWidth}
        textAnchor="middle"
        verticalAnchor={
          Math.abs(y - cy) < 1 ? "middle" : y < cy ? "end" : "start"
        }
        fontSize={11}
        lineHeight="1.2em"
        fill="var(--color-muted-foreground)"
      >
        {label}
      </Text>
    </g>
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

  if (rows.length === 0) {
    return (
      <PanelEmpty message="Nenhum indicador percentual comparável no período." />
    );
  }

  return <>{children}</>;
}
