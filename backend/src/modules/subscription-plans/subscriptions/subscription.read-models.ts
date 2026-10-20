/**
 * O que o servidor publica sobre a assinatura.
 *
 * Nada de antifraude aqui: impressão digital, documento, sinais de risco e
 * segredo não aparecem, nem em campo, nem em mensagem. Da avaliação sai no
 * máximo se ela está disponível e por quantos dias.
 */
export interface SubscriptionPeriodReadModel {
  start: string;
  end: string;
}

export interface PendingPlanChangeReadModel {
  planCode: string;
  billingInterval: string;
  effectiveAt: string;
}

export interface SubscriptionTrialReadModel {
  /** Apenas isto. O motivo de uma recusa nunca é publicado. */
  eligible: boolean;
  trialDays: number;
  startsAt: string | null;
  endsAt: string | null;
}

export interface OrganizationSubscriptionReadModel {
  id: string;
  planCode: string;
  planLabel: string;
  billingInterval: string;
  status: string;
  /** Versão para controle otimista: volta no comando seguinte. */
  version: number;
  billingPeriod: SubscriptionPeriodReadModel;
  /** Mensal em qualquer periodicidade de cobrança. */
  usagePeriod: SubscriptionPeriodReadModel;
  trial: SubscriptionTrialReadModel | null;
  cancelAtPeriodEnd: boolean;
  pendingChange: PendingPlanChangeReadModel | null;
  /** O que o servidor aceita agora. O cliente não deduz ação. */
  allowedActions: readonly string[];
}
