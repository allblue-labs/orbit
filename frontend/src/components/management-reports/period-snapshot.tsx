"use client";

/**
 * O que a operação fez no período — antes de gerar o relatório dele.
 *
 * ## Por que isto substituiu a explicação
 *
 * A Visão geral contava relatórios: quantos existem, quantos em composição,
 * quantos falharam. Números sobre a própria ferramenta. Ao lado deles havia um
 * painel explicando a diferença entre dashboard e relatório gerencial — texto
 * de documentação numa tela de trabalho.
 *
 * Quem abre Relatórios quer decidir **o que vale relatar**: como foi o mês, se a
 * conclusão caiu, se o SLA escorregou. Esses números já existem em
 * `GET /analytics/kpis`, calculados pelo servidor sobre a operação real, com o
 * período que se pedir. A tela passou a mostrá-los e a oferecer o relatório
 * daquele mesmo período.
 *
 * ## O período é o mesmo que vai para o relatório
 *
 * Escolher aqui e ter de digitar de novo na aba de geração seria transformar uma
 * decisão em duas digitações — e a segunda erraria. O botão leva o recorte
 * escolhido.
 *
 * ## A procedência viaja
 *
 * `dataQuality` distingue o que foi **observado** do que é **derivado** ou
 * **proxy**. "Contratos ativos" é o número de clientes ativos, não de contratos —
 * o servidor diz isso, e esconder a diferença faria alguém levar o número a uma
 * reunião como se fosse outra coisa.
 */
import { useMemo, useState } from "react";
import { FileBarChart, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAnalyticsKpis } from "@/hooks/dashboard/use-dashboard";
import { useActiveScope } from "@/providers/use-active-scope";
import { useSession } from "@/providers/session-provider";
import { cn } from "@/lib/utils";
import type { AnalyticsKpi } from "@/types/dashboard";
import {
  formatDayRange,
  periodFor,
  PERIOD_PRESETS,
  type PeriodPresetId,
} from "./period";

export function PeriodSnapshot({
  onGenerate,
}: {
  /** Abre a geração com este recorte já escolhido. */
  onGenerate?: (period: { from: string; to: string }) => void;
}) {
  const session = useSession();
  const { businessUnitId } = useActiveScope();
  const [preset, setPreset] = useState<PeriodPresetId>("mes-passado");

  const period = useMemo(() => periodFor(preset), [preset]);

  /* Os KPIs vêm de Analytics, que é capability própria: sem ela o painel diz o
     que falta em vez de aparecer vazio. */
  const temAnalytics = session.hasCapability("analytics.read");

  const kpis = useAnalyticsKpis(
    useMemo(
      () => ({
        /* O contrato aceita instante; o começo e o fim do dia deixam o recorte
           igual ao que o relatório vai usar. */
        from: `${period.from}T00:00:00.000Z`,
        to: `${period.to}T23:59:59.999Z`,
        businessUnitId: businessUnitId ?? undefined,
      }),
      [period, businessUnitId],
    ),
  );

  const indicadores = kpis.data?.indicators ?? [];
  const bloqueados = (kpis.data?.availability ?? []).filter(
    (dominio) => !dominio.available,
  );

  return (
    <PanelFrame
      panelId="reports-period-snapshot"
      title="Como foi o período"
      description="Os números da operação real, no recorte que você vai relatar"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {PERIOD_PRESETS.map((item) => (
            <Button
              key={item.id}
              size="sm"
              variant={item.id === preset ? "default" : "ghost"}
              onClick={() => setPreset(item.id)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      }
    >
      {!temAnalytics ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          Os indicadores da operação dependem do módulo de análises, que o plano
          atual não inclui. A geração de relatórios continua disponível.
        </p>
      ) : kpis.isPending ? (
        <PanelLoading rows={3} />
      ) : kpis.error ? (
        <PanelError error={kpis.error} onRetry={() => void kpis.refetch()} />
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {formatDayRange(period)}
          </p>

          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {indicadores.map((indicador) => (
              <KpiCard key={indicador.id} kpi={indicador} />
            ))}
          </ul>

          {bloqueados.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Sem acesso a{" "}
              {bloqueados.map((dominio) => dominio.domain).join(", ")} — os
              indicadores desses domínios não entram na conta.
            </p>
          ) : null}

          {onGenerate ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => onGenerate(period)}>
                <FileBarChart className="size-4" />
                Gerar relatório deste período
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </PanelFrame>
  );
}

/** Rótulo curto da procedência. Só aparece quando não é observação direta. */
const PROCEDENCIA: Readonly<Record<string, string>> = {
  DERIVED: "calculado",
  PROXY: "aproximação",
  MOCK: "exemplo",
};

function KpiCard({ kpi }: { kpi: AnalyticsKpi }) {
  const Seta =
    kpi.direction === "UP"
      ? TrendingUp
      : kpi.direction === "DOWN"
        ? TrendingDown
        : Minus;

  const procedencia = PROCEDENCIA[kpi.dataQuality];

  return (
    <li className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{kpi.label}</p>
      <p className="mt-1 flex items-baseline gap-1 text-xl font-semibold tabular-nums">
        {kpi.value}
        {kpi.unit ? (
          <span className="text-sm font-normal text-muted-foreground">
            {kpi.unit}
          </span>
        ) : null}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* A variação só aparece quando existe: zero em indicador sem
            comparação diria "estável" sobre uma conta que ninguém fez. */}
        {kpi.changePercent !== 0 ? (
          <span
            className={cn(
              "flex items-center gap-1 text-xs",
              kpi.direction === "UP"
                ? "text-emerald-500"
                : kpi.direction === "DOWN"
                  ? "text-destructive"
                  : "text-muted-foreground",
            )}
          >
            <Seta className="size-3" aria-hidden />
            {Math.abs(Math.round(kpi.changePercent))}
            {kpi.unit === "%" ? " p.p." : "%"}
          </span>
        ) : null}

        {procedencia ? (
          <Badge variant="outline" className="text-[10px]">
            {procedencia}
          </Badge>
        ) : null}
      </div>
    </li>
  );
}
