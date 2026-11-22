"use client";

/**
 * Este mês × mês anterior — substitui o radar comparativo.
 *
 * Uma linha por indicador: o valor deste mês em destaque, o do mesmo trecho
 * do mês anterior ao lado, a variação em palavra e cor, e duas barras finas
 * para o olho comparar sem ler. As regras (o que é melhor, sem base não é
 * zero) moram em `month-comparison.model`.
 */
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import {
  PanelEmpty,
  PanelError,
  PanelFrame,
  PanelLoading,
} from "@/components/panels";
import { cn } from "@/lib/utils";
import {
  comparisonRows,
  deltaText,
  type ComparisonRow,
} from "./month-comparison.model";
import type { WidgetProps } from "./widget-registry";

const TOM: Record<ComparisonRow["trend"], string> = {
  better: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
  worse: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:ring-rose-900",
  same: "bg-muted text-muted-foreground ring-border",
  neutral: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900",
  none: "bg-muted text-muted-foreground ring-border",
};

export function MonthComparisonWidget({ widget, comparison }: WidgetProps) {
  const { current, previous, windows } = comparison;
  const rows = useMemo(
    () =>
      current.data && previous.data
        ? comparisonRows(current.data.indicators, previous.data.indicators)
        : [],
    [current.data, previous.data],
  );

  return (
    <PanelFrame
      panelId={widget.id}
      title={widget.title}
      description={`${windows.thisMonth.label} contra ${windows.lastMonth.label}`}
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
        <div className="space-y-1">
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <Row key={row.id} row={row} />
            ))}
          </ul>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-primary" aria-hidden />
              {windows.thisMonth.label}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-muted-foreground/40" aria-hidden />
              {windows.lastMonth.label}
            </span>
          </p>
        </div>
      )}
    </PanelFrame>
  );
}

function Row({ row }: { row: ComparisonRow }) {
  const format = (value: number | null) =>
    value === null ? "—" : row.kind === "rate" ? `${Math.round(value)}%` : String(value);
  const escala =
    row.kind === "rate" ? 100 : Math.max(row.current ?? 0, row.previous ?? 0, 1);
  /* A seta segue o sinal da diferença; a cor (no selo) diz se foi bom. */
  const sinal =
    row.current !== null && row.previous !== null
      ? Math.sign(row.current - row.previous)
      : 0;
  const Icone = sinal > 0 ? ArrowUpRight : sinal < 0 ? ArrowDownRight : Minus;
  return (
    <li className="space-y-1.5 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 pt-1 text-sm leading-tight">{row.label}</span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="font-display text-lg font-semibold tabular-nums">
            {format(row.current)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            vs {format(row.previous)}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap",
              TOM[row.trend],
            )}
          >
            <Icone className="size-3" aria-hidden />
            {deltaText(row)}
          </span>
        </span>
      </div>
      <div className="space-y-1" aria-hidden>
        <Bar value={row.current} scale={escala} className="bg-primary" />
        <Bar value={row.previous} scale={escala} className="bg-muted-foreground/40" />
      </div>
      {row.currentBasis ? (
        <p className="text-[11px] text-muted-foreground">{row.currentBasis} neste mês</p>
      ) : null}
    </li>
  );
}

function Bar({
  value,
  scale,
  className,
}: {
  value: number | null;
  scale: number;
  className: string;
}) {
  const largura = value === null ? 0 : Math.max((value / scale) * 100, value > 0 ? 2 : 0);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", className)} style={{ width: `${Math.min(largura, 100)}%` }} />
    </div>
  );
}
