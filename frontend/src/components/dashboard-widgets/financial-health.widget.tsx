"use client";

/**
 * Saúde Financeira — `GET /financial/analytics/summary` e `/timeline`.
 *
 * ## Recorte próprio: 7 dias, 15 dias, este mês, 12 meses
 *
 * A pergunta do financeiro não é a mesma do resto do painel. "Como foi a
 * semana?" e "como fecha o mês?" pedem recortes curtos, dia a dia; "estamos
 * crescendo?" pede doze meses. O cartão tem o seu seletor, e os números e o
 * gráfico falam sempre do mesmo recorte — antes os números seguiam o painel e
 * a linha olhava doze meses, e as duas coisas não conversavam.
 *
 * ## Realizado, previsto e vencido, cada um no seu lugar
 *
 * Os três números grandes são caixa: recebido, pago e o saldo entre eles. O
 * que ainda não entrou fica na faixa de baixo — e o vencido aparece separado
 * por lado: entrada vencida é cobrança a fazer; saída vencida, conta atrasada.
 *
 * ## Por que este widget busca os próprios dados
 *
 * A leitura é privilegiada: quem não tem `financial.read` receberia 403 em
 * toda abertura do Dashboard se a consulta subisse para o nível
 * compartilhado. O widget consulta se, e só se, a sessão o permitir.
 */
import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import {
  FLOW_COLORS,
  FinancialFlowChart,
  FinancialWindowToggle,
  useFinancialFlow,
} from "@/components/financial/financial-flow";
import {
  FINANCIAL_WINDOWS,
  type FinancialWindowKey,
} from "@/components/financial/financial-window";
import { useSession } from "@/providers/session-provider";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { FORMATTERS } from "@/metrics";
import type { WidgetProps } from "./widget-registry";

export function FinancialHealthWidget({ widget, analytics }: WidgetProps) {
  const session = useSession();
  const allowed = session.hasCapability("financial.read");
  const [janela, setJanela] = useState<FinancialWindowKey>("MONTH");
  const { summary, rows } = useFinancialFlow(
    janela,
    analytics.query.businessUnitId,
    allowed,
  );
  const frase =
    FINANCIAL_WINDOWS.find((option) => option.key === janela)?.phrase ?? "";

  if (!allowed) {
    return (
      <PanelFrame
        panelId={widget.id}
        title={widget.title}
        description={widget.description}
      >
        <p className="text-sm text-muted-foreground">
          Seu acesso não inclui o módulo financeiro. Ele é concedido
          separadamente de operações e clientes.
        </p>
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      panelId={widget.id}
      title={widget.title}
      description={`Entradas e saídas ${frase}.`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <FinancialWindowToggle value={janela} onChange={setJanela} />
          <Button asChild size="sm" variant="ghost">
            <Link href={ROUTES.financial}>
              Abrir
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      }
    >
      <PanelState query={toPanelQuery(summary)} loadingRows={4}>
        {(data) => {
          const saldo = Number(data.netConfirmed);
          const vencidoReceber = Number(data.overdueIncome?.pending ?? 0);
          const vencidoPagar = Number(data.overdueExpense?.pending ?? 0);
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {/* As cores são as do gráfico: o número e a barra são a mesma coisa. */}
                <Figure label="Recebido" value={data.income.confirmed} color={FLOW_COLORS.income} />
                <Figure label="Pago" value={data.expense.confirmed} color={FLOW_COLORS.expense} />
                <Figure
                  label="Saldo"
                  value={data.netConfirmed}
                  color={saldo < 0 ? FLOW_COLORS.overdue : FLOW_COLORS.net}
                  hint="recebido − pago"
                />
              </div>

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
                <Pending label="A receber" value={data.income.pending} />
                <Pending label="A pagar" value={data.expense.pending} />
                <Pending label="Vencido a cobrar" value={data.overdueIncome?.pending ?? "0"} alert={vencidoReceber > 0} />
                <Pending label="Contas vencidas" value={data.overdueExpense?.pending ?? "0"} alert={vencidoPagar > 0} />
              </div>

              <FinancialFlowChart rows={rows} height={220} />
            </div>
          );
        }}
      </PanelState>
    </PanelFrame>
  );
}

function Figure({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: string;
  color: string;
  hint?: string;
}) {
  const amount = Number(value);
  return (
    <div className="min-w-0 space-y-0.5 rounded-lg border border-border px-3 py-2">
      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        {label}
      </p>
      <p className="truncate font-display text-lg font-bold tabular-nums" style={{ color }}>
        {Number.isFinite(amount) ? FORMATTERS.currency(amount) : value}
      </p>
      {hint ? <p className="truncate text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Pending({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  const amount = Number(value);
  return (
    <div className="space-y-0.5 bg-card px-3 py-2">
      <p className={cn("truncate text-[11px]", alert ? "font-medium text-destructive" : "text-muted-foreground")}>
        {label}
      </p>
      <p className={cn("truncate text-sm font-semibold tabular-nums", alert ? "text-destructive" : "text-foreground")}>
        {Number.isFinite(amount) ? FORMATTERS.currency(amount) : value}
      </p>
    </div>
  );
}
