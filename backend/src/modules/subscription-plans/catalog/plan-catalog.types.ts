/**
 * O vocabulário de planos, capacidades e limites.
 *
 * Estes nomes são **internos e estáveis**. O rótulo comercial muda com o
 * marketing; o código não muda nunca, porque contrato histórico, seed e
 * migração dependem dele.
 *
 * Nada aqui decide acesso. Quem decide é o `EntitlementService`, consultando o
 * catálogo — e o produto pergunta por **capacidade**, jamais por nome de plano.
 */
/** O mesmo ajudante dos demais literais do contrato, local a este catálogo. */
const literal = <T extends Record<string, string>>(value: T): Readonly<T> =>
  value;

/* ------------------------------------------------------------------ */
/* Planos                                                              */
/* ------------------------------------------------------------------ */

export const PlanCode = literal({
  ESSENTIAL: 'ESSENTIAL',
  PROFESSIONAL: 'PROFESSIONAL',
  PROFESSIONAL_INTELLIGENCE: 'PROFESSIONAL_INTELLIGENCE',
  ENTERPRISE_UNLIMITED: 'ENTERPRISE_UNLIMITED',
});
export type PlanCode = (typeof PlanCode)[keyof typeof PlanCode];

/**
 * A versão do catálogo congelado.
 *
 * Sobe quando a matriz muda — um limite, um preço, uma capacidade. Cada
 * assinatura guarda a versão que contratou junto com o retrato dos direitos,
 * e é isso que impede uma edição de hoje de reescrever o que foi vendido
 * ontem.
 */
export const CATALOG_VERSION = 1;

/* ------------------------------------------------------------------ */
/* Periodicidade de cobrança                                           */
/* ------------------------------------------------------------------ */

/**
 * Por quanto tempo se paga de uma vez.
 *
 * Altera preço, duração e renovação. **Não** altera direito nenhum: o mesmo
 * plano tem os mesmos limites e as mesmas capacidades nos três (§14). Por isso
 * não existem doze planos, existem quatro planos e três periodicidades (§15).
 */
export const BillingInterval = literal({
  MONTHLY: 'MONTHLY',
  SEMIANNUAL: 'SEMIANNUAL',
  ANNUAL: 'ANNUAL',
});
export type BillingInterval =
  (typeof BillingInterval)[keyof typeof BillingInterval];

/** Quantos meses de acesso cada periodicidade compra. */
export const BILLING_INTERVAL_MONTHS: Readonly<
  Record<BillingInterval, number>
> = {
  [BillingInterval.MONTHLY]: 1,
  [BillingInterval.SEMIANNUAL]: 6,
  [BillingInterval.ANNUAL]: 12,
};

/**
 * Preço, em centavos.
 *
 * Inteiro de propósito: `0.1 + 0.2` não é `0.3` em ponto flutuante, e dinheiro
 * não perdoa arredondamento silencioso. R$ 59,90 é `5990` (§13).
 */
export interface PlanPrice {
  readonly amountMinor: number;
  readonly currency: 'BRL';
}

export function brl(amountMinor: number): PlanPrice {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new Error(`Preço inválido: ${amountMinor}. Centavos, inteiro.`);
  }
  return { amountMinor, currency: 'BRL' };
}

/* ------------------------------------------------------------------ */
/* Capacidades                                                         */
/* ------------------------------------------------------------------ */

/**
 * O que a organização contratou.
 *
 * Não confundir com permissão: permissão responde "esta pessoa pode?", e
 * capacidade responde "a empresa comprou isto?". As duas se somam, nenhuma
 * substitui a outra.
 */
export const PlanCapability = literal({
  CUSTOMERS: 'CUSTOMERS',
  OPERATIONS: 'OPERATIONS',
  FIELD_OPERATIONS: 'FIELD_OPERATIONS',
  EQUIPMENT: 'EQUIPMENT',
  PMOC: 'PMOC',
  RVT: 'RVT',
  ARTIFACTS: 'ARTIFACTS',
  DOCUMENT_TEMPLATES: 'DOCUMENT_TEMPLATES',
  CUSTOMER_PORTAL: 'CUSTOMER_PORTAL',
  CUSTOMER_SERVICE_REQUESTS: 'CUSTOMER_SERVICE_REQUESTS',
  AUTOMATIONS: 'AUTOMATIONS',
  ANALYTICS: 'ANALYTICS',
  INTEGRATIONS: 'INTEGRATIONS',
  ORBIT_INTELLIGENCE: 'ORBIT_INTELLIGENCE',
  AI_ASSISTANTS: 'AI_ASSISTANTS',
});
export type PlanCapability =
  (typeof PlanCapability)[keyof typeof PlanCapability];

/* ------------------------------------------------------------------ */
/* Recursos de alocação — estado ativo simultâneo                      */
/* ------------------------------------------------------------------ */

/**
 * Quanto se pode ter ao mesmo tempo.
 *
 * "5 usuários" são cinco ativos agora, não cinco por mês. A contagem sai do
 * estado canônico no banco, não de um contador que alguém mantém.
 */
export const AllocationResource = literal({
  BUSINESS_UNITS: 'BUSINESS_UNITS',
  PLATFORM_USERS: 'PLATFORM_USERS',
  FIELD_TECHNICIANS: 'FIELD_TECHNICIANS',
  AUXILIARY_TECHNICIANS: 'AUXILIARY_TECHNICIANS',
  ACTIVE_CUSTOMERS: 'ACTIVE_CUSTOMERS',
  ACTIVE_EQUIPMENT: 'ACTIVE_EQUIPMENT',
});
export type AllocationResource =
  (typeof AllocationResource)[keyof typeof AllocationResource];

/* ------------------------------------------------------------------ */
/* Recursos de uso — eventos numa janela mensal                        */
/* ------------------------------------------------------------------ */

/**
 * Quanto se pode fazer por mês.
 *
 * A janela é sempre mensal, qualquer que venha a ser a periodicidade da
 * cobrança: assinar por ano não dá doze meses de cota de uma vez.
 */
export const UsageResource = literal({
  /**
   * A ordem de serviço canônica criada — não o documento dela.
   *
   * O nome diz o gatilho de propósito: a cota é da ordem, e renderizar o PDF
   * dela quantas vezes for preciso não cria ordem nenhuma. `ISSUED` sugeria
   * emissão de documento, que é exatamente a leitura errada.
   */
  SERVICE_ORDERS_CREATED: 'SERVICE_ORDERS_CREATED',
  PMOC_DOCUMENTS_ISSUED: 'PMOC_DOCUMENTS_ISSUED',
  RVT_DOCUMENTS_ISSUED: 'RVT_DOCUMENTS_ISSUED',
  OTHER_DOCUMENTS_ISSUED: 'OTHER_DOCUMENTS_ISSUED',
  AUTOMATION_RUNS: 'AUTOMATION_RUNS',
  AI_COMPUTE: 'AI_COMPUTE',
});
export type UsageResource = (typeof UsageResource)[keyof typeof UsageResource];

export type PlanResource = AllocationResource;

/* ------------------------------------------------------------------ */
/* Limite                                                              */
/* ------------------------------------------------------------------ */

/**
 * Um limite é **limitado com um número** ou **ilimitado**. Não há terceira
 * forma.
 *
 * Ilimitado nunca é `999999`, `-1` nem `Integer.MAX_VALUE`: um número mágico
 * um dia é comparado como número e vira teto silencioso. Aqui a ausência de
 * teto é um caso do tipo, e o compilador obriga a tratá-la.
 */
export type PlanLimit =
  | { readonly kind: 'LIMITED'; readonly value: number }
  | { readonly kind: 'UNLIMITED' };

export const UNLIMITED: PlanLimit = { kind: 'UNLIMITED' };

export function limited(value: number): PlanLimit {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `Limite inválido: ${value}. Um limite é um inteiro não negativo.`,
    );
  }
  return { kind: 'LIMITED', value };
}

export function isUnlimited(limit: PlanLimit): boolean {
  return limit.kind === 'UNLIMITED';
}

/**
 * Cabe mais `quantity` dentro do limite, sabendo o que já se tem?
 *
 * `UNLIMITED` sempre cabe. `LIMITED` cabe enquanto o total não passar do teto.
 */
export function fitsWithin(
  limit: PlanLimit,
  current: number,
  quantity = 1,
): boolean {
  if (limit.kind === 'UNLIMITED') return true;
  return current + quantity <= limit.value;
}

/* ------------------------------------------------------------------ */
/* Definição de plano                                                  */
/* ------------------------------------------------------------------ */

export interface PlanDefinition {
  readonly code: PlanCode;
  /** Rótulo comercial. Muda sem quebrar nada — nenhuma regra o consulta. */
  readonly label: string;
  readonly description: string;
  /** Preço de tabela por periodicidade, em centavos. */
  readonly prices: Readonly<Record<BillingInterval, PlanPrice>>;
  readonly capabilities: readonly PlanCapability[];
  readonly allocation: Readonly<Record<AllocationResource, PlanLimit>>;
  readonly usage: Readonly<Record<UsageResource, PlanLimit>>;
}
