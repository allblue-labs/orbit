/**
 * O que o servidor publica sobre planos e cotas.
 *
 * Duas leituras, e nenhuma delas expõe o razão: o catálogo comercial, que é
 * global e igual para todo mundo, e a situação da organização — quanto já se
 * usou, qual é o teto, quanto falta. O cliente **lê**; quem calcula limite é o
 * servidor (§95).
 *
 * Nada de Stripe, período de cobrança, avaliação gratuita ou identificador de
 * preço: isso é da PR-PL-02 em diante.
 */

/** Um teto, na forma em que o cliente pode confiar. */
export type PlanLimitReadModel =
  { unlimited: true; value: null } | { unlimited: false; value: number };

/** Preço de uma periodicidade. `amountMinor` é a autoridade; o texto é vitrine. */
export interface PlanPriceReadModel {
  amountMinor: number;
  currency: string;
  formatted: string;
}

export interface PlanCatalogEntryReadModel {
  /** Código interno estável. É por ele que se compara, nunca pelo rótulo. */
  code: string;
  label: string;
  description: string;
  monthlyPrice: string;
  currency: string;
  /** `MONTHLY`, `SEMIANNUAL` e `ANNUAL`. Mesmos direitos, preços diferentes. */
  prices: Readonly<Record<string, PlanPriceReadModel>>;
  capabilities: readonly string[];
  allocation: Readonly<Record<string, PlanLimitReadModel>>;
  usage: Readonly<Record<string, PlanLimitReadModel>>;
}

export interface PlanCatalogReadModel {
  plans: readonly PlanCatalogEntryReadModel[];
}

export interface ResourceEntitlementReadModel {
  resource: string;
  current: number;
  limit: PlanLimitReadModel;
  /** `null` quando não há teto. Não é zero, e não é um número mágico. */
  remaining: number | null;
}

export interface OrganizationEntitlementsReadModel {
  planCode: string;
  label: string;
  /** `CATALOG`, `CUSTOM` ou `LEGACY_UNGOVERNED`. */
  source: string;
  capabilities: readonly string[];
  /** A janela mensal vigente. Sempre mensal, ancorada na assinatura. */
  window: { start: string; end: string };
  allocation: readonly ResourceEntitlementReadModel[];
  usage: readonly ResourceEntitlementReadModel[];
}
