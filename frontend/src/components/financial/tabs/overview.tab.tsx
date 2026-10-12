"use client";

/**
 * Visão Geral — só Financial Analytics.
 *
 * Três leituras: `summary`, `timeline` e `categories`. Nenhum número desta aba
 * é somado, subtraído ou projetado no navegador — `netConfirmed` e
 * `netPending` chegam prontos, e recalculá-los criaria uma segunda aritmética
 * financeira que divergiria da primeira no primeiro arredondamento.
 *
 * ## Realizado e previsto nunca se misturam
 *
 * Não existe card de "saldo" que some os dois. Realizado é caixa; previsto é
 * expectativa. O gráfico separa por **traço**: linha cheia para o que
 * aconteceu, tracejada para o que ainda pode não acontecer — a distinção
 * sobrevive à impressão em preto e branco, que a cor sozinha não faz.
 *
 * ## Cada painel cai sozinho
 *
 * Os três têm `TabBoundary` e estado próprio: a série falhar não apaga os
 * indicadores, e a distribuição vazia não esconde o gráfico.
 */
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PanelChartFrame,
  PanelFrame,
  PanelState,
  toPanelQuery,
} from "@/components/panels";
import {
  useFinancialBreakdown,
  useFinancialSummary,
  useFinancialTimeline,
} from "@/hooks/financial/use-financial";
import { useActiveScope } from "@/providers/use-active-scope";
import { FORMATTERS } from "@/metrics";
import { MetricCard, TabBoundary } from "@/workspace";
import {
  FINANCIAL_TYPE_LABELS,
  type FinancialAnalyticsQuery,
  type FinancialCategoryBreakdown,
  type FinancialTimelinePoint,
} from "@/types/financial";
import { formatMonth } from "../financial-presentation";

/**
 * Primeiro e último dia do mês corrente, em `YYYY-MM-DD`.
 *
 * É o mesmo padrão que o backend aplica quando o período é omitido. Enviá-lo
 * explicitamente mantém a query key estável entre renders — e faz o cabeçalho
 * mostrar o recorte que está valendo, em vez de deixá-lo implícito.
 */
function currentMonth(): { from: string; to: string } {
  const now = new Date();
  const pad = (value: number) => `${value}`.padStart(2, "0");
  const year = now.getFullYear();
  const month = now.getMonth();
  const last = new Date(year, month + 1, 0).getDate();
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(last)}`,
  };
}

/**
 * Número para o `MetricCard`.
 *
 * Conversão de apresentação, não de negócio: o card formata pelo Metric
 * Registry, e o registry trabalha com número. O valor exibido continua sendo
 * exatamente o que o servidor publicou.
 */
const toNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export function FinancialOverviewTab() {
  const [period, setPeriod] = useState(currentMonth);
  const { businessUnits, businessUnitId } = useActiveScope();

  /**
   * Unidade: a do escopo ativo.
   *
   * O Financeiro não inventa um seletor paralelo — a unidade em uso é a que o
   * cabeçalho da aplicação já mostra. O filtro por unidade específica existe na
   * aba de lançamentos, onde se investiga; aqui a pergunta é "como estamos".
   */
  const query = useMemo<FinancialAnalyticsQuery>(
    () => ({
      from: period.from,
      to: period.to,
      businessUnitId: businessUnitId ?? undefined,
    }),
    [period.from, period.to, businessUnitId],
  );

  const summary = useFinancialSummary(query);
  const unitName = businessUnits.find(
    (unit) => unit.id === businessUnitId,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Competência de {period.from.slice(0, 10)} a {period.to.slice(0, 10)}
            {unitName
              ? ` · ${unitName.tradeName ?? unitName.legalName}`
              : " · todas as organizações acessíveis"}
          </p>
          <p className="text-xs text-muted-foreground">
            Os totais vêm calculados. Nada nesta aba é somado no navegador.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="financial-overview-from">De</Label>
            <Input
              id="financial-overview-from"
              type="date"
              value={period.from}
              onChange={(event) =>
                setPeriod((current) => ({
                  ...current,
                  from: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="financial-overview-to">Até</Label>
            <Input
              id="financial-overview-to"
              type="date"
              value={period.to}
              onChange={(event) =>
                setPeriod((current) => ({ ...current, to: event.target.value }))
              }
            />
          </div>
        </div>
      </div>

      {/* Realizado */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Realizado</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            metricId="financial.netConfirmed"
            value={toNumber(summary.data?.netConfirmed)}
            isPending={summary.isPending}
            failed={Boolean(summary.error)}
            showDescription
          />
          <MetricCard
            metricId="financial.income.confirmed"
            value={toNumber(summary.data?.income.confirmed)}
            isPending={summary.isPending}
            failed={Boolean(summary.error)}
          />
          <MetricCard
            metricId="financial.expense.confirmed"
            value={toNumber(summary.data?.expense.confirmed)}
            isPending={summary.isPending}
            failed={Boolean(summary.error)}
          />
        </div>
      </section>

      {/* Previsto — separado, e dito com todas as letras */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium">Previsto</h2>
          <p className="text-xs text-muted-foreground">
            Lançamentos ainda não confirmados. Não entram no caixa.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            metricId="financial.netPending"
            value={toNumber(summary.data?.netPending)}
            isPending={summary.isPending}
            failed={Boolean(summary.error)}
          />
          <MetricCard
            metricId="financial.income.pending"
            value={toNumber(summary.data?.income.pending)}
            isPending={summary.isPending}
            failed={Boolean(summary.error)}
          />
          <MetricCard
            metricId="financial.expense.pending"
            value={toNumber(summary.data?.expense.pending)}
            isPending={summary.isPending}
            failed={Boolean(summary.error)}
          />
          <MetricCard
            metricId="financial.overdue.pending"
            value={toNumber(summary.data?.overdue.pending)}
            isPending={summary.isPending}
            failed={Boolean(summary.error)}
            showDescription
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <TabBoundary id="financial-timeline" label="a evolução">
          <TimelinePanel query={query} />
        </TabBoundary>
        <TabBoundary id="financial-breakdown" label="a distribuição">
          <BreakdownPanel query={query} />
        </TabBoundary>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Evolução mensal                                                     */
/* ------------------------------------------------------------------ */

function TimelinePanel({ query }: { query: FinancialAnalyticsQuery }) {
  const timeline = useFinancialTimeline(query);

  return (
    <PanelChartFrame
      panelId="financial-timeline"
      title="Evolução"
      description="Receitas, despesas e saldo por mês de competência"
      height={300}
    >
      <PanelState
        query={toPanelQuery(timeline)}
        isEmpty={(points) => points.length === 0}
        emptyMessage="Nenhum lançamento com competência dentro do recorte selecionado."
      >
        {(points) => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={toRows(points)}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--color-border)"
              vertical={false}
            />
            <XAxis
              dataKey="month"
              stroke="var(--color-muted-foreground)"
              fontSize={12}
            />
            <YAxis
              stroke="var(--color-muted-foreground)"
              fontSize={12}
              tickFormatter={(value: number) => FORMATTERS.currency(value)}
              width={90}
            />
            <Tooltip
              formatter={(value: number) => FORMATTERS.currency(value)}
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.5rem",
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="incomeConfirmed"
              name="Receita realizada"
              stroke="var(--color-chart-2)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="expenseConfirmed"
              name="Despesa realizada"
              stroke="var(--color-chart-5)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="netConfirmed"
              name="Saldo realizado"
              stroke="var(--color-chart-1)"
              strokeWidth={2}
              dot={false}
            />
            {/* Tracejado: previsto não é caixa, e o traço diz isso sem cor. */}
            <Line
              type="monotone"
              dataKey="incomePending"
              name="Receita prevista"
              stroke="var(--color-chart-2)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="expensePending"
              name="Despesa prevista"
              stroke="var(--color-chart-5)"
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
        )}
      </PanelState>
    </PanelChartFrame>
  );
}

/**
 * Reorganização de forma, não cálculo.
 *
 * Cada ponto já vem com os cinco valores do mês, inclusive `netConfirmed`. O
 * `Number()` existe porque o eixo do gráfico precisa de número — e é a única
 * coisa que acontece com esses valores aqui.
 */
function toRows(points: readonly FinancialTimelinePoint[]) {
  return points.map((point) => ({
    month: formatMonth(point.month),
    incomeConfirmed: Number(point.incomeConfirmed),
    expenseConfirmed: Number(point.expenseConfirmed),
    incomePending: Number(point.incomePending),
    expensePending: Number(point.expensePending),
    netConfirmed: Number(point.netConfirmed),
  }));
}

/* ------------------------------------------------------------------ */
/* Distribuição por categoria                                          */
/* ------------------------------------------------------------------ */

const SLICE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function BreakdownPanel({ query }: { query: FinancialAnalyticsQuery }) {
  const breakdown = useFinancialBreakdown(query);
  const [side, setSide] = useState<"INCOME" | "EXPENSE">("EXPENSE");

  /**
   * O recorte por lado é local — e pode ser.
   *
   * A resposta já traz `type` em cada linha; escolher qual metade mostrar é
   * navegação na mesma leitura, não filtro de dados. Nenhum valor é somado:
   * cada linha vem com o seu próprio total realizado.
   */
  return (
    <PanelFrame
      panelId="financial-breakdown"
      title="Por categoria"
      description="Realizado no período, por categoria"
      actions={
        <div
          className="flex rounded-lg border border-border p-0.5"
          role="group"
          aria-label="Sentido"
        >
          {(["EXPENSE", "INCOME"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSide(option)}
              aria-pressed={option === side}
              className={
                option === side
                  ? "rounded-md bg-secondary px-3 py-1 text-xs text-secondary-foreground"
                  : "rounded-md px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              }
            >
              {FINANCIAL_TYPE_LABELS[option]}
            </button>
          ))}
        </div>
      }
    >
      <PanelState
        query={toPanelQuery(breakdown)}
        isEmpty={(data) => toSlices(data, side).length === 0}
        emptyMessage="Nada realizado neste recorte. Só entram lançamentos confirmados; os previstos aparecem nos indicadores acima."
      >
        {(data) => {
          const rows = toSlices(data, side);
          return (
        <div className="space-y-4">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rows}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {rows.map((row, index) => (
                    <Cell
                      key={row.name}
                      fill={SLICE_COLORS[index % SLICE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => FORMATTERS.currency(value)}
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: "0.5rem",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul className="space-y-2 text-sm">
            {rows.map((row, index) => (
              <li
                key={row.name}
                className="flex items-center justify-between gap-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{
                      background: SLICE_COLORS[index % SLICE_COLORS.length],
                    }}
                    aria-hidden
                  />
                  <span className="truncate">{row.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {row.count}
                  </span>
                </span>
                <span className="font-mono tabular-nums">
                  {FORMATTERS.currency(row.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
          );
        }}
      </PanelState>
    </PanelFrame>
  );
}

/**
 * Um lado da distribuição.
 *
 * A resposta já traz `type` em cada linha; escolher qual metade mostrar é
 * navegação na mesma leitura, não filtro de dados. Nenhum valor é somado —
 * cada linha vem com o seu próprio total realizado.
 */
function toSlices(
  data: readonly FinancialCategoryBreakdown[],
  side: "INCOME" | "EXPENSE",
) {
  return data
    .filter((row) => row.type === side)
    .map((row) => ({
      name: row.categoryName,
      value: Number(row.confirmed),
      count: row.count,
    }))
    .filter((row) => row.value > 0);
}

