/**
 * Contratos do Financeiro.
 *
 * Nenhum Read Model é redeclarado aqui: todos vêm de
 * `contracts/modules/financial`, sincronizados do backend. O que este arquivo
 * acrescenta são os **tipos de entrada** — o que a tela envia — e os rótulos
 * em português dos literais.
 *
 * ## Dinheiro é string, e continua string
 *
 * `amount` chega como `"1250.40"` e é exibido assim. A conversão para número
 * acontece **uma vez**, na formatação, e nunca para somar: totais e saldos são
 * do servidor. O frontend não faz aritmética financeira — um centavo perdido
 * em ponto flutuante é um centavo que ninguém consegue explicar depois.
 */
import type {
  FinancialCategoryBreakdownReadModel,
  FinancialCategoryReadModel,
  FinancialEntryReadModel,
  FinancialSettingsReadModel,
  FinancialSummaryReadModel,
  FinancialTimelinePointReadModel,
  FinancialTotalsReadModel,
} from "./contracts/modules/financial/financial.read-models";
import type {
  FinancialEntrySource,
  FinancialEntryStatus,
  FinancialEntryType,
} from "./contracts";

export type {
  FinancialEntrySource,
  FinancialEntryStatus,
  FinancialEntryType,
};

/** Lançamento (`GET /financial/entries`). */
export type FinancialEntry = FinancialEntryReadModel;

/** Categoria de receita ou despesa (`GET /financial/categories`). */
export type FinancialCategory = FinancialCategoryReadModel;

/** Configuração financeira da organização (`GET /financial/settings`). */
export type FinancialSettings = FinancialSettingsReadModel;

export type FinancialSummary = FinancialSummaryReadModel;
export type FinancialTotals = FinancialTotalsReadModel;
export type FinancialCategoryBreakdown = FinancialCategoryBreakdownReadModel;
export type FinancialTimelinePoint = FinancialTimelinePointReadModel;

/* -------------------------------------------------------------------- */
/* Consultas                                                             */
/* -------------------------------------------------------------------- */

/** `GET /financial/entries` (`FinancialEntryQueryDto`). */
export interface FinancialEntryQuery {
  search?: string;
  type?: FinancialEntryType;
  status?: FinancialEntryStatus;
  source?: FinancialEntrySource;
  /**
   * Registro que originou o lançamento.
   *
   * Responde "qual é a previsão deste orçamento" pelo servidor. Filtrar
   * páginas no cliente erraria assim que o resultado passasse de uma página.
   */
  sourceEntityId?: string;
  categoryId?: string;
  businessUnitId?: string;
  customerId?: string;
  operationId?: string;
  /** Competência a partir de (inclusive), `YYYY-MM-DD`. */
  from?: string;
  /** Competência até (inclusive), `YYYY-MM-DD`. */
  to?: string;
  /**
   * Somente pendentes vencidos.
   *
   * O servidor recusa combiná-lo com `status` diferente de `PENDING` — vencido
   * é pendente por definição, e a contradição vira 400 em vez de resultado
   * silenciosamente errado.
   */
  overdue?: boolean;
  page?: number;
  limit?: number;
}

/** `GET /financial/analytics/*` (`FinancialAnalyticsQueryDto`). */
export interface FinancialAnalyticsQuery {
  from?: string;
  to?: string;
  businessUnitId?: string;
}

/** `GET /financial/categories` (`FinancialCategoryQueryDto`). */
export interface FinancialCategoryQuery {
  type?: FinancialEntryType;
}

/* -------------------------------------------------------------------- */
/* Escritas                                                              */
/* -------------------------------------------------------------------- */

/**
 * `POST /financial/entries`.
 *
 * `amount` é `number` aqui porque é o que o DTO aceita (`@IsNumber`), com no
 * máximo duas casas. É o único ponto do módulo em que dinheiro é número — e é
 * o valor que a pessoa acabou de digitar, não um total calculado.
 */
export interface CreateFinancialEntryInput {
  type: FinancialEntryType;
  /**
   * `CANCELLED` não é aceito: nascer cancelado é lançamento que não precisou
   * existir.
   *
   * União literal escrita à mão em vez de `Extract<FinancialEntryStatus, …>`:
   * o helper `literal()` dos contratos infere `Record<string, string>`, então
   * `FinancialEntryStatus` é `string` e o `Extract` resultaria em `never`.
   */
  status?: "PENDING" | "CONFIRMED";
  businessUnitId?: string;
  categoryId?: string;
  amount: number;
  currency?: string;
  description: string;
  notes?: string;
  competenceDate?: string;
  dueDate?: string;
  customerId?: string;
  operationId?: string;
}

/**
 * `PATCH /financial/entries/:id`.
 *
 * Sem `type`, `status`, `source` e `businessUnitId` — o DTO do backend não os
 * aceita. Sentido, situação, procedência e dono mudam por ato próprio, que
 * registra autor e data; um `PATCH` que os trocasse apagaria essa história.
 */
export interface UpdateFinancialEntryInput {
  categoryId?: string;
  amount?: number;
  description?: string;
  notes?: string;
  competenceDate?: string;
  dueDate?: string;
  customerId?: string;
  operationId?: string;
}

export interface ConfirmFinancialEntryInput {
  confirmedAt?: string;
}

/** O motivo é obrigatório — o servidor recusa cancelamento sem explicação. */
export interface CancelFinancialEntryInput {
  reason: string;
}

export interface CreateFinancialCategoryInput {
  type: FinancialEntryType;
  name: string;
  description?: string;
  color?: string;
  sortOrder?: number;
}

/** Sem `type`: o backend não aceita trocar o lado de uma categoria em uso. */
export interface UpdateFinancialCategoryInput {
  name?: string;
  description?: string;
  color?: string;
  sortOrder?: number;
}

export interface UpdateFinancialSettingsInput {
  autoRecordReceipts?: boolean;
  defaultCurrency?: string;
}

/* -------------------------------------------------------------------- */
/* Rótulos                                                               */
/* -------------------------------------------------------------------- */

export const FINANCIAL_TYPE_LABELS: Readonly<
  Record<FinancialEntryType | string, string>
> = {
  INCOME: "Receita",
  EXPENSE: "Despesa",
};

export const FINANCIAL_STATUS_LABELS: Readonly<
  Record<FinancialEntryStatus | string, string>
> = {
  PENDING: "Previsto",
  CONFIRMED: "Realizado",
  CANCELLED: "Cancelado",
};

/**
 * Procedência do lançamento.
 *
 * O rótulo diz **de onde o fato veio**, porque é o que muda o que a pessoa
 * pode fazer com ele: o que veio de um recibo não se edita, se cancela.
 */
export const FINANCIAL_SOURCE_LABELS: Readonly<
  Record<FinancialEntrySource | string, string>
> = {
  MANUAL: "Manual",
  RECEIPT: "Recibo emitido",
  QUOTE: "Orçamento",
  SYSTEM: "Automático",
};

export const FINANCIAL_SOURCE_DESCRIPTIONS: Readonly<
  Record<FinancialEntrySource | string, string>
> = {
  MANUAL: "Digitado por alguém da equipe.",
  RECEIPT:
    "Gerado automaticamente quando um recibo foi oficialmente emitido. O valor é o do documento.",
  QUOTE: "Derivado de um orçamento aprovado.",
  SYSTEM: "Gerado pela plataforma a partir de outro registro.",
};

/* ------------------------------------------------------------------ */
/* Recibo                                                             */
/* ------------------------------------------------------------------ */

/**
 * O que se informa para emitir um recibo.
 *
 * `amount` é **texto**: o valor vai para um campo decimal do documento e para o
 * lançamento de receita, e `number` em JSON é ponto flutuante — um centavo perdido
 * num recibo é um recibo contestável.
 *
 * Nem número nem template entram: o número é do servidor e o modelo é o oficial de
 * recibo da organização. Deixar a tela escolher permitiria emitir um recibo com o
 * modelo de PMOC.
 */
export interface CreateReceiptInput {
  /** Atendimento de origem, quando o recibo nasce de um serviço executado. */
  operationId?: string;
  customerId?: string;
  businessUnitId?: string;
  payer: string;
  payerDocument?: string;
  amount: string;
  /** `YYYY-MM-DD`. */
  paidOn: string;
  referring: string;
  paymentMethod?: string;
}

/** O atendimento concluído que pode originar um recibo, com o que oferece pronto. */
export interface ReceiptSource {
  id: string;
  code: string;
  serviceOrderNumber: number | null;
  title: string;
  status: string;
  completedAt: string | null;
  customer: {
    id: string;
    legalName: string;
    tradeName: string | null;
    documentNumber: string | null;
  } | null;
}
