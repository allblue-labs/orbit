/**
 * O vocabulário da assinatura e as regras que ele carrega.
 *
 * A máquina de estados é do Orbit, não do provedor de pagamento. Quando o
 * Stripe entrar, ele traduzirá os eventos dele para **estes** comandos — o
 * contrário faria a nossa regra comercial virar refém do vocabulário de um
 * fornecedor.
 */
const literal = <T extends Record<string, string>>(value: T): Readonly<T> =>
  value;

export const SubscriptionStatus = literal({
  /** Contratação criada, mas ainda sem pagamento ou avaliação vigente. */
  PENDING_PAYMENT: 'PENDING_PAYMENT',
  /** Acesso temporário concedido pelo Orbit, sem pagamento. */
  TRIALING: 'TRIALING',
  /** Assinatura vigente e provisionada. */
  ACTIVE: 'ACTIVE',
  /** Cobrança reportada como pendente. O acesso continua. */
  PAST_DUE: 'PAST_DUE',
  /** Carência após falha de pagamento. O acesso continua, com prazo. */
  GRACE_PERIOD: 'GRACE_PERIOD',
  /** Acesso comercial suspenso. Nenhum dado é destruído. */
  SUSPENDED: 'SUSPENDED',
  /** Encerrada depois de o período contratado terminar. */
  CANCELED: 'CANCELED',
  /** A avaliação ou o período acabou sem renovação. */
  EXPIRED: 'EXPIRED',
});
export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/**
 * Quem ainda enxerga o produto.
 *
 * Decidido **aqui**, num lugar só. Espalhar `if (status === 'SUSPENDED')` pelos
 * serviços garantiria que um deles ficasse para trás na próxima mudança.
 *
 * `PAST_DUE` e `GRACE_PERIOD` mantêm o acesso de propósito: uma cobrança que
 * falhou é quase sempre um cartão vencido, e derrubar a operação de campo de
 * uma empresa por isso seria a punição errada para o problema errado.
 */
const COM_ACESSO: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.GRACE_PERIOD,
]);

export function grantsProductAccess(status: SubscriptionStatus): boolean {
  return COM_ACESSO.has(status);
}

/** Estados a partir dos quais ainda se pode trocar de plano. */
const PODE_TROCAR_DE_PLANO: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.PENDING_PAYMENT,
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
]);

export function allowsPlanChange(status: SubscriptionStatus): boolean {
  return PODE_TROCAR_DE_PLANO.has(status);
}

/** Estados que ainda podem abrir a primeira contratação no provedor. */
const PODE_INICIAR_CHECKOUT: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatus.PENDING_PAYMENT,
  SubscriptionStatus.TRIALING,
]);

export function allowsInitialCheckout(status: SubscriptionStatus): boolean {
  return PODE_INICIAR_CHECKOUT.has(status);
}

/**
 * As transições permitidas.
 *
 * Fechada por omissão: o que não está aqui é recusado. Uma máquina de estados
 * permissiva não é uma máquina de estados.
 */
const TRANSICOES: Readonly<
  Record<SubscriptionStatus, readonly SubscriptionStatus[]>
> = {
  PENDING_PAYMENT: ['ACTIVE', 'CANCELED', 'EXPIRED'],
  TRIALING: ['ACTIVE', 'CANCELED', 'EXPIRED'],
  ACTIVE: ['PAST_DUE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELED', 'EXPIRED'],
  PAST_DUE: ['ACTIVE', 'GRACE_PERIOD', 'SUSPENDED', 'CANCELED'],
  GRACE_PERIOD: ['ACTIVE', 'SUSPENDED', 'CANCELED'],
  SUSPENDED: ['ACTIVE', 'CANCELED'],
  /** Terminais: uma nova contratação nasce como assinatura nova. */
  CANCELED: [],
  EXPIRED: [],
};

export function allowsTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return allowedTransitions(from).includes(to);
}

export function allowedTransitions(
  from: SubscriptionStatus,
): readonly SubscriptionStatus[] {
  /** Estado desconhecido não tem saída: fechada por omissão. */
  return TRANSICOES[from] ?? [];
}

/** Estados em que a assinatura deixou de valer e a linha pode ser encerrada. */
export function isTerminal(status: SubscriptionStatus): boolean {
  return allowedTransitions(status).length === 0;
}

/** A carência congelada: sete dias após a falha de pagamento. */
export const GRACE_PERIOD_DAYS = 7;

/** A avaliação congelada: trinta dias, e só no Essencial. */
export const TRIAL_DAYS = 30;

export const TrialGrantStatus = literal({
  GRANTED: 'GRANTED',
  CONVERTED: 'CONVERTED',
  EXPIRED: 'EXPIRED',
});
export type TrialGrantStatus =
  (typeof TrialGrantStatus)[keyof typeof TrialGrantStatus];

export const TrialRiskDecision = literal({
  ALLOW: 'ALLOW',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  DENY: 'DENY',
});
export type TrialRiskDecision =
  (typeof TrialRiskDecision)[keyof typeof TrialRiskDecision];
