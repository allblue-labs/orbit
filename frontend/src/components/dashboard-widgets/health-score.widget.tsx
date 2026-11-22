"use client";

/**
 * Saúde da operação — substitui o "Índice de Saúde".
 *
 * Mesmas barras horizontais, outra pergunta: em vez de uma nota de 0 a 100
 * feita de média com pesos, cada barra responde uma pergunta da rotina — a
 * fila está no prazo? tem técnico? tem data? os PMOC estão em dia? — com a
 * contagem ("9 de 12") e o problema em palavra ("3 atrasados"), e leva à
 * lista onde se resolve. As regras moram em `operation-health.model`.
 *
 * Os números são os do período escolhido no painel (`analytics.dashboard`).
 */
import Link from "next/link";
import { CheckCircle2, ChevronRight, TriangleAlert } from "lucide-react";

import { PanelFrame, PanelState } from "@/components/panels";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  operationHealth,
  type HealthBar,
  type HealthTone,
} from "./operation-health.model";
import type { WidgetProps } from "./widget-registry";

const BARRA: Record<HealthTone, string> = {
  ok: "bg-emerald-500",
  attention: "bg-amber-500",
  critical: "bg-rose-500",
};
const TEXTO: Record<HealthTone, string> = {
  ok: "text-emerald-700 dark:text-emerald-400",
  attention: "text-amber-700 dark:text-amber-400",
  critical: "text-rose-700 dark:text-rose-400",
};
const DESTINO: Record<HealthBar["area"], string> = {
  operations: ROUTES.operations,
  pmoc: ROUTES.pmoc,
  rvt: ROUTES.rvt,
};

export function HealthScoreWidget({ widget, analytics }: WidgetProps) {
  const resumo = analytics.dashboard.data
    ? operationHealth(analytics.dashboard.data.metrics)
    : null;

  return (
    <PanelFrame
      panelId={widget.id}
      title={widget.title}
      description={widget.description}
      actions={
        resumo && resumo.bars.length > 0 ? (
          resumo.attention === 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Tudo em ordem
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <TriangleAlert className="size-3.5" aria-hidden />
              {resumo.attention}{" "}
              {resumo.attention === 1 ? "ponto de atenção" : "pontos de atenção"}
            </span>
          )
        ) : null
      }
    >
      <PanelState query={analytics.dashboard} loadingRows={5}>
        {(data) => {
          const { bars, withoutData } = operationHealth(data.metrics);
          if (bars.length === 0)
            return (
              <p className="text-sm text-muted-foreground">
                Ainda não há atendimentos, PMOC ou RVT neste período para
                avaliar a operação.
              </p>
            );
          return (
            <div className="space-y-4">
              <ul className="space-y-3.5">
                {bars.map((bar) => (
                  <li key={bar.id}>
                    <Link
                      href={DESTINO[bar.area]}
                      className="group block space-y-1.5 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate group-hover:underline">
                          {bar.label}
                        </span>
                        <span className={cn("shrink-0 font-semibold tabular-nums", TEXTO[bar.tone])}>
                          {bar.percent}%
                        </span>
                      </div>
                      <div
                        className="h-2 w-full overflow-hidden rounded-full bg-muted"
                        role="meter"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={bar.percent}
                        aria-label={bar.label}
                      >
                        <div
                          className={cn("h-full rounded-full transition-all", BARRA[bar.tone])}
                          style={{ width: `${bar.percent}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {bar.numerator} de {bar.denominator}
                        </span>
                        {bar.gap ? (
                          <span className={cn("flex items-center gap-0.5 font-medium", TEXTO[bar.tone])}>
                            {bar.gap}
                            <ChevronRight className="size-3.5" aria-hidden />
                          </span>
                        ) : (
                          <span>tudo certo</span>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {withoutData.length > 0 ? (
                <p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
                  Sem dados neste período: {withoutData.join(", ").toLowerCase()}.
                </p>
              ) : null}
            </div>
          );
        }}
      </PanelState>
    </PanelFrame>
  );
}
