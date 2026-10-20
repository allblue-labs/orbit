/**
 * O que a tela oferece, derivado do que o servidor autorizou.
 *
 * ## Por que isto é um módulo, e não um `if` no componente
 *
 * É a única lógica de decisão que o navegador executa nesta superfície, e é
 * exatamente a que precisa de prova: que nenhuma ação nasce de código de
 * plano, de preço ou de status — só de `allowedActions`.
 *
 * Se o servidor deixar de autorizar uma ação, ela some da tela sem que ninguém
 * altere componente nenhum.
 */
import {
  SubscriptionAction,
  type BillingOverview,
  type OrganizationSubscription,
} from "@/types/billing";

export interface BillingActions {
  canSubscribe: boolean;
  canChangePlan: boolean;
  canCancelRenewal: boolean;
  canKeepSubscription: boolean;
  canOpenBillingPortal: boolean;
  canCancelScheduledChange: boolean;
}

const VAZIO: BillingActions = {
  canSubscribe: false,
  canChangePlan: false,
  canCancelRenewal: false,
  canKeepSubscription: false,
  canOpenBillingPortal: false,
  canCancelScheduledChange: false,
};

export function derivarAcoes(overview: BillingOverview): BillingActions {
  const daAssinatura = new Set(overview.subscription?.allowedActions ?? []);
  const daCobranca = new Set(overview.billing.allowedActions);

  return {
    /**
     * Contratar exige as duas pontas: o provedor configurado e o servidor
     * autorizando. Uma sem a outra produziria um botão que falha ao ser
     * clicado.
     */
    canSubscribe:
      overview.billing.configured &&
      overview.billing.canCheckout &&
      daCobranca.has(SubscriptionAction.START_CHECKOUT),
    canChangePlan: daAssinatura.has(SubscriptionAction.CHANGE_PLAN),
    canCancelRenewal: daAssinatura.has(SubscriptionAction.CANCEL_AT_PERIOD_END),
    canKeepSubscription: daAssinatura.has(SubscriptionAction.KEEP_SUBSCRIPTION),
    canOpenBillingPortal:
      overview.billing.configured &&
      overview.billing.canOpenBillingPortal &&
      daCobranca.has(SubscriptionAction.OPEN_BILLING_PORTAL),
    canCancelScheduledChange: daAssinatura.has(
      SubscriptionAction.CANCEL_SCHEDULED_CHANGE,
    ),
  };
}

/** Com a cobrança desligada, nada é oferecido — e a página continua de pé. */
export function acoesIndisponiveis(): BillingActions {
  return VAZIO;
}

/**
 * A avaliação aparece?
 *
 * Somente quando o servidor a declara elegível. O navegador não sabe quem já
 * testou, não sabe o documento da empresa e **não pode** saber: o motivo da
 * recusa é justamente o que o antifraude não publica.
 */
export function mostraAvaliacao(
  subscription: OrganizationSubscription | null,
): boolean {
  return subscription?.trial?.eligible === true;
}
