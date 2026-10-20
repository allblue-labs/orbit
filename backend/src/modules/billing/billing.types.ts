/**
 * O vocabulário de cobrança — sem uma linha do SDK do provedor.
 *
 * Este arquivo é a fronteira. Acima dele o Orbit fala de plano, periodicidade e
 * assinatura; abaixo, um adaptador traduz para o que o provedor entende. Nada
 * aqui importa `stripe`, e é isso que permite trocar de provedor sem reescrever
 * domínio — ou testar o fluxo inteiro sem chave nenhuma.
 */
import type {
  BillingInterval,
  PlanCode,
} from '../subscription-plans/catalog/plan-catalog.types';

export const BILLING_PROVIDER = Symbol('BILLING_PROVIDER');

/** Um provedor só, por enquanto. Enum ornamental não ajuda ninguém. */
export const BillingProviderName = { STRIPE: 'STRIPE' } as const;
export type BillingProviderName =
  (typeof BillingProviderName)[keyof typeof BillingProviderName];

/** O modo da conta. Misturar preço de teste com chave real é acidente comum. */
export const BillingMode = { TEST: 'TEST', LIVE: 'LIVE' } as const;
export type BillingMode = (typeof BillingMode)[keyof typeof BillingMode];

/**
 * O estado do provedor, já normalizado.
 *
 * Deliberadamente **não** são os estados do Stripe. `incomplete_expired` e
 * `unpaid` são gramática de um fornecedor; o que o Orbit precisa saber é se o
 * pagamento está em dia, se falhou, se acabou — e se não deu para saber.
 */
export const ProviderBillingState = {
  /** Em avaliação aprovada pelo Orbit e espelhada no provedor. */
  TRIALING: 'TRIALING',
  /** Pago e em dia. */
  ACTIVE: 'ACTIVE',
  /** Cobrança falhou de verdade — não é indisponibilidade do provedor. */
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  /** Encerrada no provedor. */
  ENDED: 'ENDED',
  /** Criada, mas ainda sem primeiro pagamento confirmado. */
  INCOMPLETE: 'INCOMPLETE',
  /** Estado que este código não conhece. Nunca vira acesso. */
  UNKNOWN: 'UNKNOWN',
} as const;
export type ProviderBillingState =
  (typeof ProviderBillingState)[keyof typeof ProviderBillingState];

/** O retrato normalizado de uma assinatura no provedor. */
export interface ProviderSubscription {
  readonly providerSubscriptionId: string;
  readonly providerCustomerId: string;
  readonly providerPriceId: string | null;
  readonly state: ProviderBillingState;
  /** O texto cru do provedor. Diagnóstico, nunca decisão. */
  readonly rawStatus: string;
  readonly currentPeriodStart: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly trialEndsAt: Date | null;
  /**
   * O que o provedor diz ser a versão desta linha.
   *
   * Serve para descartar evento velho sem depender de `event.created`: dois
   * eventos podem nascer no mesmo segundo, e o que importa é qual objeto é o
   * mais novo — por isso a reconciliação busca o objeto canônico.
   */
  readonly providerUpdatedAt: Date | null;
}

/** Resultado de uma troca, sem vazar o vocabulário do SDK para a aplicação. */
export interface ProviderPlanChange {
  readonly subscription: ProviderSubscription;
  /** `true` quando o preço novo só entra no próximo período contratado. */
  readonly scheduled: boolean;
  readonly effectiveAt: Date;
  /** Identidade diagnóstica; nunca é aceita do cliente. */
  readonly providerScheduleId: string | null;
}

export const ProviderInvoiceStatus = {
  DRAFT: 'DRAFT',
  OPEN: 'OPEN',
  PAID: 'PAID',
  VOID: 'VOID',
  UNCOLLECTIBLE: 'UNCOLLECTIBLE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ProviderInvoiceStatus =
  (typeof ProviderInvoiceStatus)[keyof typeof ProviderInvoiceStatus];

/** Fatura normalizada; deliberadamente sem PII ou dados do meio de pagamento. */
export interface ProviderInvoice {
  readonly providerInvoiceId: string;
  readonly providerSubscriptionId: string | null;
  readonly providerCustomerId: string;
  readonly number: string | null;
  readonly status: ProviderInvoiceStatus;
  readonly currency: string;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly amountDueMinor: number;
  readonly amountPaidMinor: number;
  readonly amountRemainingMinor: number;
  readonly creditNotesMinor: number;
  readonly attempted: boolean;
  readonly attemptCount: number;
  readonly billingReason: string | null;
  readonly collectionMethod: string;
  readonly hostedInvoiceUrl: string | null;
  readonly invoicePdfUrl: string | null;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly dueAt: Date | null;
  readonly nextPaymentAttemptAt: Date | null;
  readonly finalizedAt: Date | null;
  readonly paidAt: Date | null;
  readonly voidedAt: Date | null;
  readonly markedUncollectibleAt: Date | null;
  readonly providerCreatedAt: Date;
  readonly providerObservedAt: Date;
}

export const ProviderFinancialAdjustmentType = {
  REFUND: 'REFUND',
  DISPUTE: 'DISPUTE',
} as const;
export type ProviderFinancialAdjustmentType =
  (typeof ProviderFinancialAdjustmentType)[keyof typeof ProviderFinancialAdjustmentType];

export interface ProviderFinancialAdjustment {
  readonly type: ProviderFinancialAdjustmentType;
  readonly providerObjectId: string;
  readonly providerInvoiceId: string;
  readonly status: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason: string | null;
  readonly occurredAt: Date;
  readonly providerObservedAt: Date;
}

export interface CheckoutSessionRequest {
  readonly checkoutAttemptId: string;
  readonly organizationId: string;
  readonly providerCustomerId: string;
  readonly planCode: PlanCode;
  readonly billingInterval: BillingInterval;
  /** Dias de avaliação **decididos pelo Orbit**. Nunca pelo cliente. */
  readonly trialDays: number | null;
  readonly idempotencyKey: string;
  readonly subscriptionId: string | null;
}

export interface CheckoutSession {
  readonly providerSessionId: string;
  readonly url: string;
  readonly expiresAt: Date | null;
}

export const ProviderCheckoutState = {
  OPEN: 'OPEN',
  COMPLETE: 'COMPLETE',
  EXPIRED: 'EXPIRED',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ProviderCheckoutState =
  (typeof ProviderCheckoutState)[keyof typeof ProviderCheckoutState];

/** Retrato canônico e mínimo de uma Checkout Session. */
export interface ProviderCheckoutSession {
  readonly providerSessionId: string;
  readonly state: ProviderCheckoutState;
  readonly rawStatus: string;
  readonly paymentStatus: string;
  readonly providerCustomerId: string | null;
  readonly providerSubscriptionId: string | null;
  readonly providerPriceId: string | null;
  readonly url: string | null;
  readonly expiresAt: Date | null;
  readonly metadata: Readonly<{
    checkoutAttemptId: string | null;
    organizationId: string | null;
    subscriptionId: string | null;
    planCode: string | null;
    billingInterval: string | null;
  }>;
}

export interface BillingPortalSession {
  readonly url: string;
}

export interface ProviderEvent {
  readonly providerEventId: string;
  readonly type: string;
  readonly apiVersion: string | null;
  readonly createdAt: Date;
  /** O objeto que o evento tocou — assinatura, fatura, sessão. */
  readonly objectId: string | null;
  /** A assinatura do provedor envolvida, quando dá para saber pelo evento. */
  readonly subscriptionId: string | null;
}

/**
 * A porta.
 *
 * Um método só existe aqui se alguém o chama. Porta com método sem consumidor
 * é promessa que ninguém verificou.
 */
export interface BillingProvider {
  readonly name: BillingProviderName;
  readonly mode: BillingMode;
  /** Configurado e utilizável? Falso desliga cobrança sem derrubar o produto. */
  isEnabled(): boolean;

  createCustomer(input: {
    organizationId: string;
    displayName: string;
    idempotencyKey: string;
  }): Promise<{ providerCustomerId: string }>;

  createCheckoutSession(
    request: CheckoutSessionRequest,
  ): Promise<CheckoutSession>;

  retrieveCheckoutSession(
    providerSessionId: string,
  ): Promise<ProviderCheckoutSession>;

  createBillingPortalSession(input: {
    providerCustomerId: string;
  }): Promise<BillingPortalSession>;

  retrieveSubscription(
    providerSubscriptionId: string,
  ): Promise<ProviderSubscription>;

  retrieveInvoice(providerInvoiceId: string): Promise<ProviderInvoice>;

  retrieveFinancialAdjustment(
    type: ProviderFinancialAdjustmentType,
    providerObjectId: string,
  ): Promise<ProviderFinancialAdjustment>;

  /** Troca o preço da assinatura. O provedor calcula o dinheiro, não o Orbit. */
  changePlan(input: {
    providerSubscriptionId: string;
    organizationId: string;
    subscriptionId: string;
    planCode: PlanCode;
    billingInterval: BillingInterval;
    /** `IMMEDIATE` para subir; `PERIOD_END` para descer. */
    timing: 'IMMEDIATE' | 'PERIOD_END';
    idempotencyKey: string;
  }): Promise<ProviderPlanChange>;

  cancelScheduledPlanChange(input: {
    providerSubscriptionId: string;
    organizationId: string;
    subscriptionId: string;
    idempotencyKey: string;
  }): Promise<ProviderSubscription>;

  setCancelAtPeriodEnd(input: {
    providerSubscriptionId: string;
    cancelAtPeriodEnd: boolean;
    idempotencyKey: string;
  }): Promise<ProviderSubscription>;

  /** Verifica assinatura sobre o corpo **cru**. Nunca sobre JSON reserializado. */
  verifyWebhook(rawBody: Buffer, signature: string): ProviderEvent;

  /** Valida o catálogo de preços contra o do Orbit. */
  verifyPriceCatalog(): Promise<readonly PriceVerification[]>;
}

export interface PriceVerification {
  readonly planCode: PlanCode;
  readonly billingInterval: BillingInterval;
  readonly configured: boolean;
  readonly valid: boolean;
  /** Motivo interno da recusa. Nunca vai para resposta pública. */
  readonly problem: string | null;
}
