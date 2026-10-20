"use client";

import type { ReactNode } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Trend = "up" | "down" | "neutral";

/**
 * Altura reservada para o rótulo, em linhas.
 *
 * Classes literais num mapa, e não `min-h-[${n}lh]`: o Tailwind varre o código em
 * busca de nomes de classe, e uma classe montada em tempo de execução não existe no
 * CSS gerado. `text-sm` tem 20px de linha, então duas linhas são 40px.
 */
const ALTURA_DO_ROTULO: Readonly<Record<1 | 2, string>> = {
  1: "",
  2: "min-h-10",
};

export function StatCard({
  label,
  value,
  hint,
  trend = "neutral",
  delta,
  icon,
  className,
  labelLines = 1,
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: Trend;
  delta?: string;
  icon?: ReactNode;
  className?: string;
  /**
   * Quantas linhas o rótulo reserva.
   *
   * Numa grade de cartões, um rótulo que quebra em duas linhas empurra o valor para
   * baixo **só naquele cartão**, e os números deixam de se alinhar na mesma altura —
   * é o que fazia os Indicadores Executivos parecerem desiguais. Reservar as duas
   * linhas desde o início alinha os valores entre vizinhos.
   *
   * Fica em `1` por omissão porque fora de grade reservar espaço vazio é só espaço
   * vazio: quem pede é quem tem vizinhos para alinhar.
   */
  labelLines?: 1 | 2;
}) {
  return (
    <Card className={cn("glass-panel gap-0 py-5", className)}>
      <CardContent className="space-y-3 px-5">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "text-sm text-muted-foreground",
              ALTURA_DO_ROTULO[labelLines],
            )}
          >
            {label}
          </p>
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
        </div>
        <p className="font-display text-3xl font-semibold tracking-tight">
          {value}
        </p>
        <div className="flex items-center gap-2 text-xs">
          {delta ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5",
                trend === "up" && "bg-success/15 text-success",
                trend === "down" && "bg-destructive/15 text-destructive",
                trend === "neutral" &&
                  "bg-surface-strong text-muted-foreground",
              )}
            >
              {trend === "up" ? <TrendingUp className="size-3" /> : null}
              {trend === "down" ? <TrendingDown className="size-3" /> : null}
              {delta}
            </span>
          ) : null}
          {hint ? <span className="text-muted-foreground">{hint}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}

/** Compact KPI tile — denser variant of StatCard for grids and widgets. */
export function KpiCard({
  label,
  value,
  progress,
  className,
}: {
  label: string;
  value: string;
  progress?: number;
  className?: string;
}) {
  return (
    <div className={cn("glass rounded-xl p-4", className)}>
      <p className="text-xs tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p className="font-display mt-2 text-2xl font-semibold">{value}</p>
      {typeof progress === "number" ? (
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-strong"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div
            className="bg-gradient-orbit h-full rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
