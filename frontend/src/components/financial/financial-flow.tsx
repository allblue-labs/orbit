"use client";

/**
 * O fluxo financeiro em barras e a situação do caixa em pizza.
 *
 * Usados no Dashboard (Saúde Financeira) e na página do Financeiro — a mesma
 * leitura, o mesmo desenho, as mesmas cores: receita não troca de cor ao
 * mudar de tela.
 *
 * ## Barras, e não linhas
 *
 * Num recorte de 7 ou 15 dias a pergunta é "em que dia entrou e saiu
 * dinheiro" — e dia sem movimento é zero, não um ponto ligando dois outros.
 * Cada dia tem duas colunas: o que entrou (recebido sólido, a receber claro em
 * cima) e o que saiu (pago sólido, a pagar claro). A linha é o saldo
 * realizado acumulado desde o início do recorte.
 */
import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  useFinancialSummary,
  useFinancialTimeline,
} from "@/hooks/financial/use-financial";
import { useTimeZone } from "@/hooks/use-timezone";
import { zonedDateKey } from "@/lib/scheduling/timezone";
import { cn } from "@/lib/utils";
import { FORMATTERS } from "@/metrics";
import type { FinancialSummary } from "@/types/financial";
import {
  FINANCIAL_WINDOWS,
  financialWindow,
  flowRows,
  statusSlices,
  type FinancialWindowKey,
  type FlowRow,
} from "./financial-window";

export const FLOW_COLORS = {
  income: "var(--color-chart-2)",
  expense: "var(--color-chart-5)",
  net: "var(--color-chart-1)",
  overdue: "var(--color-destructive)",
} as const;

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.5rem",
  fontSize: "0.8125rem",
};

/** `R$ 12,3 mil` — o eixo precisa caber; o cursor dá o valor exato. */
const compacto = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** As leituras de um recorte: totais do período e a série para o gráfico. */
export function useFinancialFlow(
  key: FinancialWindowKey,
  businessUnitId: string | undefined,
  enabled = true,
) {
  const { timeZone } = useTimeZone();
  const today = zonedDateKey(new Date(), timeZone);
  const window = useMemo(() => financialWindow(key, today), [key, today]);
  const summary = useFinancialSummary(
    enabled ? { from: window.from, to: window.to, businessUnitId } : undefined,
  );
  const timeline = useFinancialTimeline(
    enabled
      ? {
          from: window.from,
          to: window.to,
          granularity: window.granularity,
          businessUnitId,
        }
      : undefined,
  );
  const rows = useMemo(
    () => (timeline.data ? flowRows(timeline.data, window) : []),
    [timeline.data, window],
  );
  return { window, summary, timeline, rows };
}

export function FinancialWindowToggle({
  value,
  onChange,
}: {
  value: FinancialWindowKey;
  onChange: (value: FinancialWindowKey) => void;
}) {
  return (
    <div
      className="flex rounded-lg border border-border p-0.5"
      role="group"
      aria-label="Período do financeiro"
    >
      {FINANCIAL_WINDOWS.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          aria-pressed={option.key === value}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs whitespace-nowrap transition-colors",
            option.key === value
              ? "bg-secondary font-medium text-secondary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function FinancialFlowChart({
  rows,
  height = 240,
}: {
  rows: readonly FlowRow[];
  height?: number;
}) {
  const vazio = rows.every(
    (row) => !row.recebido && !row.aReceber && !row.pago && !row.aPagar,
  );
  if (vazio)
    return (
      <p
        className="flex items-center justify-center rounded-lg border border-dashed border-border text-center text-xs text-muted-foreground"
        style={{ height }}
      >
        Nenhuma entrada ou saída lançada neste período.
      </p>
    );
  /* Com muitos dias, rótulo sim, rótulo não — trinta datas não cabem. */
  const intervalo = rows.length > 16 ? Math.ceil(rows.length / 10) - 1 : 0;
  return (
    <div>
      <div style={{ height: height - 22 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={[...rows]}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
            barGap={2}
            barCategoryGap={rows.length > 16 ? "18%" : "28%"}
          >
            <CartesianGrid
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              interval={intervalo}
            />
            <YAxis
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={58}
              tickFormatter={(value: number) => compacto.format(value)}
            />
            <Tooltip
              cursor={{ fill: "var(--color-muted)", opacity: 0.4 }}
              formatter={(value: number, name: string) => [
                FORMATTERS.currency(value),
                name,
              ]}
              contentStyle={tooltipStyle}
            />
            <Bar
              dataKey="recebido"
              name="Recebido"
              stackId="entrada"
              fill={FLOW_COLORS.income}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="aReceber"
              name="A receber"
              stackId="entrada"
              fill={FLOW_COLORS.income}
              fillOpacity={0.35}
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="pago"
              name="Pago"
              stackId="saida"
              fill={FLOW_COLORS.expense}
            />
            <Bar
              dataKey="aPagar"
              name="A pagar"
              stackId="saida"
              fill={FLOW_COLORS.expense}
              fillOpacity={0.35}
              radius={[4, 4, 0, 0]}
            />
            {/* Acumulado e reto: o caixa sobe e desce em degraus de dia, e uma
              curva suavizada inventava valores entre dois dias — chegava a
              mostrar saldo negativo onde não havia movimento nenhum. */}
            <Line
              type="linear"
              dataKey="saldoAcumulado"
              name="Saldo acumulado"
              stroke={FLOW_COLORS.net}
              strokeWidth={2}
              dot={rows.length <= 16 ? { r: 2.5 } : false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <FlowLegend />
    </div>
  );
}

/**
 * Legenda própria: a do Recharts ignora a transparência, e "A receber"
 * aparecia com a mesma cor de "Recebido" — justamente o que ela diferencia.
 */
function FlowLegend() {
  const itens: Array<{
    label: string;
    color: string;
    opacity?: number;
    line?: boolean;
  }> = [
    { label: "Recebido", color: FLOW_COLORS.income },
    { label: "A receber", color: FLOW_COLORS.income, opacity: 0.35 },
    { label: "Pago", color: FLOW_COLORS.expense },
    { label: "A pagar", color: FLOW_COLORS.expense, opacity: 0.35 },
    { label: "Saldo acumulado", color: FLOW_COLORS.net, line: true },
  ];
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-[11px] text-muted-foreground">
      {itens.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={
              item.line ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-sm"
            }
            style={{ background: item.color, opacity: item.opacity ?? 1 }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Para onde foi (ou vai) o dinheiro do período: realizado, no prazo e vencido.
 *
 * É a pergunta que o gráfico de linhas não respondia — "quanto do que eu
 * faturei já entrou, e quanto está atrasado?". Numa empresa de manutenção, o
 * vencido a receber é o primeiro número a cobrar.
 */
export function FinancialStatusDonut({
  summary,
}: {
  summary: FinancialSummary;
}) {
  const [side, setSide] = useState<"INCOME" | "EXPENSE">("INCOME");
  const totals =
    side === "INCOME"
      ? {
          confirmed: summary.income.confirmed,
          pending: summary.income.pending,
          overdue: summary.overdueIncome?.pending ?? "0",
        }
      : {
          confirmed: summary.expense.confirmed,
          pending: summary.expense.pending,
          overdue: summary.overdueExpense?.pending ?? "0",
        };
  const slices = statusSlices(side, totals);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const cor = side === "INCOME" ? FLOW_COLORS.income : FLOW_COLORS.expense;
  const colors = [cor, cor, FLOW_COLORS.overdue];
  const opacities = [1, 0.4, 1];

  return (
    <div className="space-y-4">
      <div
        className="flex rounded-lg border border-border p-0.5"
        role="group"
        aria-label="Entradas ou saídas"
      >
        {(["INCOME", "EXPENSE"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setSide(option)}
            aria-pressed={option === side}
            className={cn(
              "flex-1 rounded-md px-3 py-1 text-xs transition-colors",
              option === side
                ? "bg-secondary font-medium text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option === "INCOME" ? "Entradas" : "Saídas"}
          </button>
        ))}
      </div>
      {total === 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">
          Nenhuma {side === "INCOME" ? "entrada" : "saída"} lançada neste
          período.
        </p>
      ) : (
        <div className="grid items-center gap-4 sm:grid-cols-[180px_1fr]">
          <div className="relative h-44">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices.filter((slice) => slice.value > 0)}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={52}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="var(--color-card)"
                >
                  {slices
                    .map((slice, index) => ({ slice, index }))
                    .filter(({ slice }) => slice.value > 0)
                    .map(({ slice, index }) => (
                      <Cell
                        key={slice.key}
                        fill={colors[index]}
                        fillOpacity={opacities[index]}
                      />
                    ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => FORMATTERS.currency(value)}
                  contentStyle={tooltipStyle}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[11px] text-muted-foreground">Total</span>
              <span className="text-sm font-semibold tabular-nums">
                {compacto.format(total)}
              </span>
            </div>
          </div>
          <ul className="space-y-2.5 text-sm">
            {slices.map((slice, index) => (
              <li
                key={slice.key}
                className="flex items-center justify-between gap-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      background: colors[index],
                      opacity: opacities[index],
                    }}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "truncate",
                      index === 2 &&
                        slice.value > 0 &&
                        "font-medium text-destructive",
                    )}
                  >
                    {slice.label}
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-mono text-sm tabular-nums">
                    {FORMATTERS.currency(slice.value)}
                  </span>
                  <span className="block text-[11px] text-muted-foreground tabular-nums">
                    {total ? Math.round((slice.value / total) * 100) : 0}%
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
