/**
 * Contratos de plano, assinatura e cobrança.
 *
 * Espelham o que o backend publica, e **nada aqui é decidido no cliente**:
 * preço, ações permitidas, elegibilidade de avaliação e limites chegam
 * prontos. A tela apresenta; quem decide é o servidor.
 *
 * Nenhum identificador do provedor de pagamento aparece nestes tipos — o
 * navegador não conhece preço de provedor, e não precisa conhecer.
 */

/** Um teto, na forma em que o servidor o publica. */
export type PlanLimit =
  { unlimited: true; value: null } | { unlimited: false; value: number };

export interface PlanPrice {
  /** Centavos. É esta a autoridade; o texto é vitrine. */
  amountMinor: number;
  currency: string;
  formatted: string;
}

export interface PlanCatalogEntry {
  code: string;
  label: string;
  description: string;
  monthlyPrice: string;
  currency: string;
  prices: Readonly<Record<string, PlanPrice>>;
  capabilities: readonly string[];
  allocation: Readonly<Record<string, PlanLimit>>;
  usage: Readonly<Record<string, PlanLimit>>;
}

export interface PlanCatalog {
  plans: readonly PlanCatalogEntry[];
}

export interface SubscriptionPeriod {
  start: string;
  end: string;
}

export interface PendingPlanChange {
  planCode: string;
  billingInterval: string;
  effectiveAt: string;
}

export interface SubscriptionTrial {
  eligible: boolean;
  trialDays: number;
  startsAt: string | null;
  endsAt: string | null;
}

export interface OrganizationSubscription {
  id: string;
  planCode: string;
  planLabel: string;
  billingInterval: string;
  status: string;
  /** Volta em todo comando: é o controle otimista do servidor. */
  version: number;
  billingPeriod: SubscriptionPeriod;
  /** Mensal em qualquer periodicidade de cobrança. */
  usagePeriod: SubscriptionPeriod;
  trial: SubscriptionTrial | null;
  cancelAtPeriodEnd: boolean;
  dataRetentionEndsAt?: string | null;
  dataPurgedAt?: string | null;
  pendingChange: PendingPlanChange | null;
  allowedActions: readonly string[];
}

export interface ResourceEntitlement {
  resource: string;
  current: number;
  limit: PlanLimit;
  /** `null` quando não há teto. Não é zero. */
  remaining: number | null;
}

export interface OrganizationEntitlementsView {
  planCode: string;
  label: string;
  source: string;
  capabilities: readonly string[];
  window: SubscriptionPeriod;
  allocation: readonly ResourceEntitlement[];
  usage: readonly ResourceEntitlement[];
  limitAdjustment?: {
    effectiveAt: string;
    deadline: string;
    blocked: boolean;
    resources: readonly ResourceEntitlement[];
  } | null;
}

export interface BillingReadiness {
  configured: boolean;
  mode: string | null;
  canCheckout: boolean;
  canStartEssentialTrial?: boolean;
  canOpenBillingPortal: boolean;
  allowedActions: readonly string[];
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  status: string;
  currency: string;
  totalMinor: number;
  amountPaidMinor: number;
  amountRemainingMinor: number;
  creditNotesMinor: number;
  attemptCount: number;
  period: SubscriptionPeriod;
  dueAt: string | null;
  nextPaymentAttemptAt: string | null;
  paidAt: string | null;
  issuedAt: string;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  adjustments: readonly BillingFinancialAdjustment[];
}

export interface BillingFinancialAdjustment {
  id: string;
  type: string;
  status: string;
  amountMinor: number;
  currency: string;
  reason: string | null;
  occurredAt: string;
}

/** Tudo o que a tela precisa, numa leitura. */
export interface BillingOverview {
  catalog: PlanCatalog;
  /** `null` para organização sem assinatura. Não é erro. */
  subscription: OrganizationSubscription | null;
  entitlements: OrganizationEntitlementsView;
  billing: BillingReadiness;
  /** Histórico financeiro canônico, sem IDs internos do provedor. */
  invoices: readonly BillingInvoice[];
  dataRetentionEndsAt?: string | null;
  dataPurgeStartedAt?: string | null;
  dataPurgedAt?: string | null;
}

export interface CheckoutSessionResult {
  subscriptionId?: string;
  url: string;
  expiresAt: string | null;
}

export interface BillingPortalResult {
  url: string;
}

/**
 * O que o corpo da contratação carrega — e só isso.
 *
 * Sem valor, sem moeda, sem identificador de preço, sem dias de avaliação e
 * sem organização: o servidor recusa qualquer um deles, e o tipo existe para
 * que nem se tente.
 */
export interface CreateCheckoutInput {
  planCode: string;
  billingInterval: string;
}

export interface ChangePlanInput {
  expectedVersion: number;
  planCode: string;
  billingInterval?: string;
  acknowledgeTrialEnd?: boolean;
}

export interface SubscriptionVersionInput {
  expectedVersion: number;
}

/* ------------------------------------------------------------------ */
/* Apresentação                                                        */
/* ------------------------------------------------------------------ */

/** As periodicidades, na ordem em que aparecem. */
export const BILLING_INTERVALS = ["MONTHLY", "SEMIANNUAL", "ANNUAL"] as const;
export type BillingIntervalCode = (typeof BILLING_INTERVALS)[number];

export const BILLING_INTERVAL_LABELS: Readonly<Record<string, string>> = {
  MONTHLY: "Mensal",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
};

/** Quantos meses cada periodicidade compra — só para o equivalente mensal. */
export const BILLING_INTERVAL_MONTHS: Readonly<Record<string, number>> = {
  MONTHLY: 1,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

/**
 * O estado da assinatura em português.
 *
 * Tradução de apresentação, não regra: nenhuma decisão desta tela olha para
 * estas chaves. Se o servidor publicar um estado que não está aqui, mostra-se
 * o texto neutro em vez do código cru.
 */
export const SUBSCRIPTION_STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING_PAYMENT: "Aguardando contratação",
  TRIALING: "Período de teste",
  ACTIVE: "Ativa",
  PAST_DUE: "Pagamento pendente",
  GRACE_PERIOD: "Período de regularização",
  SUSPENDED: "Suspensa",
  CANCELED: "Cancelada",
  EXPIRED: "Expirada",
};

/** Rótulos dos recursos. O wording de campo é o aprovado pelo negócio. */
export const ENTITLEMENT_RESOURCE_LABELS: Readonly<Record<string, string>> = {
  BUSINESS_UNITS: "Organizações",
  PLATFORM_USERS: "Usuários",
  FIELD_TECHNICIANS: "Técnicos operadores",
  AUXILIARY_TECHNICIANS: "auxiliares técnico",
  ACTIVE_CUSTOMERS: "Clientes",
  ACTIVE_EQUIPMENT: "Equipamentos",
  SERVICE_ORDERS_CREATED: "Ordens de serviço",
  PMOC_DOCUMENTS_ISSUED: "PMOC",
  RVT_DOCUMENTS_ISSUED: "RVT",
  OTHER_DOCUMENTS_ISSUED: "Outros documentos",
  AUTOMATION_RUNS: "Automações",
};

/**
 * Recursos que a tela **não** mostra.
 *
 * `AI_COMPUTE` existe para medição interna e não tem teto comercial definido;
 * publicar um número aqui prometeria uma cota que não foi congelada.
 */
export const HIDDEN_ENTITLEMENT_RESOURCES: ReadonlySet<string> = new Set([
  "AI_COMPUTE",
]);

/** As ações que o servidor pode autorizar. A tela nunca as inventa. */
export const SubscriptionAction = {
  SUBSCRIBE: "SUBSCRIBE",
  CANCEL_AT_PERIOD_END: "CANCEL_AT_PERIOD_END",
  KEEP_SUBSCRIPTION: "KEEP_SUBSCRIPTION",
  CHANGE_PLAN: "CHANGE_PLAN",
  CANCEL_SCHEDULED_CHANGE: "CANCEL_SCHEDULED_CHANGE",
  START_CHECKOUT: "START_CHECKOUT",
  OPEN_BILLING_PORTAL: "OPEN_BILLING_PORTAL",
} as const;

export type ChangePlanResult =
  | BillingPortalResult
  | { kind: "TRIAL_STARTED"; endsAt: string }
  | { kind: "SCHEDULED"; effectiveAt: string };

export interface CancelSubscriptionInput extends SubscriptionVersionInput {
  acknowledgeDataDeletion: true;
}
