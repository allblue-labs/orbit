"use client";

/**
 * A assinatura atual.
 *
 * O primeiro bloco da página, porque é a pergunta que traz a pessoa aqui:
 * qual plano eu tenho, quanto custa e até quando vale. Tudo vem do servidor —
 * inclusive quais botões existem.
 */
import { CalendarClock, CreditCard } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelFrame } from "@/components/panels";
import { formatDate } from "@/lib/formatters";
import { useSession } from "@/providers/session-provider";
import { BILLING_INTERVAL_LABELS, type BillingOverview } from "@/types/billing";
import { derivarAcoes } from "./billing-actions";
import {
  diasAte,
  equivalenteMensal,
  formatCentavos,
  rotuloDoStatus,
} from "./billing-format";

interface Props {
  overview: BillingOverview;
  onCancelRenewal: () => void;
  onKeepSubscription: () => void;
  onCancelScheduledChange: () => void;
  onOpenPortal: () => void;
  portalPending: boolean;
  commandPending: boolean;
}

/**
 * De onde vem o acesso em vigor, em palavras de produto.
 *
 * O servidor publica códigos (`LEGACY_UNGOVERNED`, `TRIAL`, `PLAN`) e um código
 * cru na tela faz o leitor perguntar o que significa. O que não se reconhece
 * aparece como "Concedido" em vez de virar o código.
 */
function rotuloDaOrigem(source: string): string {
  const rotulos: Readonly<Record<string, string>> = {
    PLAN: "Plano contratado",
    SUBSCRIPTION: "Plano contratado",
    TRIAL: "Avaliação",
    TRIALING: "Avaliação",
    LEGACY_UNGOVERNED: "Acesso anterior à cobrança",
    GRANT: "Concedido",
  };
  return rotulos[source] ?? "Concedido";
}

/** Estados em que a assinatura merece um aviso, não só um selo. */
const VARIANTE_DO_SELO: Readonly<
  Record<string, "default" | "secondary" | "destructive" | "outline">
> = {
  PENDING_PAYMENT: "outline",
  ACTIVE: "default",
  TRIALING: "secondary",
  PAST_DUE: "outline",
  GRACE_PERIOD: "outline",
  SUSPENDED: "destructive",
  CANCELED: "destructive",
  EXPIRED: "destructive",
};

export function CurrentSubscriptionCard({
  overview,
  onCancelRenewal,
  onKeepSubscription,
  onCancelScheduledChange,
  onOpenPortal,
  portalPending,
  commandPending,
}: Props) {
  const { subscription, catalog, entitlements } = overview;
  const session = useSession();

  /**
   * Quem decide se o acesso vale é a sessão, e não a janela daqui.
   *
   * `entitlements.window` é calculada pelo módulo de cobrança e **não** é a
   * mesma coisa que o período que o `ActivePlanGuard` confere: numa conta com
   * a avaliação vencida ela mostrava 14/09 — 14/10 enquanto o servidor já
   * recusava toda escrita com `402`. A página para onde o selo "Assinatura
   * vencida" leva dizia "o acesso atual continua valendo" — e essa é
   * exatamente a página onde a pessoa vai resolver o problema.
   *
   * Unificar as duas origens é trabalho do módulo de cobrança. O que não pode
   * esperar é a tela contradizer o servidor.
   */
  const vencida = session.isAuthenticated && !session.subscriptionActive;

  /**
   * Sem assinatura não é erro.
   *
   * Uma organização anterior à cobrança continua operando pelo acesso que já
   * tinha — dizer "sem plano" afirmaria uma restrição que não existe. A
   * exceção é quando esse acesso **acabou**: aí a frase vira uma promessa que
   * o servidor não cumpre.
   */
  if (!subscription) {
    return (
      <PanelFrame
        panelId="billing-current"
        title="Plano atual"
        description="O plano em vigor nesta organização"
      >
        {/*
          Diz **qual** acesso está valendo, e não só que falta assinatura.

          A frase anterior — "ainda não tem assinatura registrada" — era
          verdadeira e inútil: quem abre esta aba quer saber o que tem hoje, e a
          resposta existe. `entitlements` publica o plano em vigor, o rótulo
          público dele e de onde ele vem.
        */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-lg font-semibold">
              {entitlements.label}
            </p>
            <Badge variant="secondary">
              {rotuloDaOrigem(entitlements.source)}
            </Badge>
          </div>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">
                {vencida ? "Acesso encerrado em" : "Período em curso"}
              </dt>
              <dd className="mt-0.5 text-sm">
                {vencida
                  ? session.subscriptionEndsAt
                    ? formatDate(session.subscriptionEndsAt)
                    : "—"
                  : `${formatDate(entitlements.window.start)} — ${formatDate(
                      entitlements.window.end,
                    )}`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Cobrança</dt>
              <dd className="mt-0.5 text-sm">Sem assinatura registrada</dd>
            </div>
          </dl>

          {vencida ? (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm font-medium text-warning">
                O período de acesso terminou
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Consultar o histórico e baixar os documentos já emitidos
                continua funcionando. Criar e alterar registros fica pausado até
                a contratação de um plano.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              O acesso atual continua valendo. Escolha um plano abaixo para
              contratar quando quiser passar para a cobrança regular.
            </p>
          )}
        </div>
      </PanelFrame>
    );
  }

  const plano = catalog.plans.find(
    (item) => item.code === subscription.planCode,
  );
  const preco = plano?.prices[subscription.billingInterval];
  const equivalente = preco
    ? equivalenteMensal(preco.amountMinor, subscription.billingInterval)
    : null;
  const acoes = derivarAcoes(overview);
  const diasRestantes = diasAte(subscription.billingPeriod.end);

  return (
    <PanelFrame
      panelId="billing-current"
      title="Plano atual"
      description="O plano em vigor nesta organização"
      actions={
        <Badge variant={VARIANTE_DO_SELO[subscription.status] ?? "secondary"}>
          {rotuloDoStatus(subscription.status)}
        </Badge>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display text-2xl font-bold">
            {/* O rótulo público. O código do plano nunca aparece. */}
            {plano?.label ?? subscription.planLabel}
          </span>
          {preco ? (
            <span className="text-sm text-muted-foreground">
              {formatCentavos(preco.amountMinor)} ·{" "}
              {BILLING_INTERVAL_LABELS[subscription.billingInterval] ??
                "periodicidade"}
            </span>
          ) : null}
        </div>

        {equivalente && preco ? (
          <p className="text-xs text-muted-foreground">
            Equivale a {equivalente} por mês, cobrados{" "}
            {formatCentavos(preco.amountMinor)} por período.
          </p>
        ) : null}

        {subscription.trial?.endsAt ? (
          <p className="flex items-center gap-2 text-sm">
            <CalendarClock
              className="size-4 text-muted-foreground"
              aria-hidden
            />
            Período de teste até {formatDate(subscription.trial.endsAt)}
            {diasAte(subscription.trial.endsAt) > 0
              ? ` · restam ${diasAte(subscription.trial.endsAt)} dias`
              : null}
          </p>
        ) : null}

        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">
              {subscription.cancelAtPeriodEnd
                ? "Acesso garantido até"
                : "Próxima renovação"}
            </dt>
            <dd className="text-sm font-medium tabular-nums">
              {formatDate(subscription.billingPeriod.end)}
              {diasRestantes > 0 ? (
                <span className="ml-2 font-normal text-muted-foreground">
                  em {diasRestantes} dias
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Uso do plano até</dt>
            <dd className="text-sm font-medium tabular-nums">
              {formatDate(subscription.usagePeriod.end)}
            </dd>
          </div>
        </dl>

        {/*
          Cancelamento agendado não é cancelamento. A assinatura continua
          ativa até a data — dizer "cancelada" agora seria mentir sobre o
          acesso que a empresa ainda tem.
        */}
        {subscription.cancelAtPeriodEnd ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            Sua assinatura será encerrada em{" "}
            <strong>{formatDate(subscription.billingPeriod.end)}</strong> e não
            será renovada. Até lá, nada muda.
          </p>
        ) : null}

        {subscription.pendingChange ? (
          <p className="rounded-md border border-border bg-muted/40 p-3 text-sm">
            <strong>Mudança programada.</strong> Seu plano mudará para{" "}
            {catalog.plans.find(
              (item) => item.code === subscription.pendingChange!.planCode,
            )?.label ?? "outro plano"}{" "}
            em {formatDate(subscription.pendingChange.effectiveAt)}.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {acoes.canOpenBillingPortal ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onOpenPortal}
              disabled={portalPending}
            >
              <CreditCard className="size-4" aria-hidden />
              {portalPending ? "Abrindo…" : "Gerenciar cobrança"}
            </Button>
          ) : null}

          {acoes.canKeepSubscription ? (
            <Button
              size="sm"
              onClick={onKeepSubscription}
              disabled={commandPending}
            >
              Manter assinatura
            </Button>
          ) : null}

          {acoes.canCancelRenewal ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelRenewal}
              disabled={commandPending}
            >
              Cancelar renovação
            </Button>
          ) : null}

          {acoes.canCancelScheduledChange ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancelScheduledChange}
              disabled={commandPending}
            >
              Desfazer mudança programada
            </Button>
          ) : null}
        </div>
      </div>
    </PanelFrame>
  );
}
