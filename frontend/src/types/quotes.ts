/**
 * Contratos do Commercial Engine.
 *
 * Nenhum Read Model é redeclarado: todos vêm de `contracts/modules/quotes`,
 * sincronizados do backend. O que este arquivo acrescenta são os tipos de
 * entrada e os rótulos em português.
 *
 * ## A máquina de estados não é reimplementada aqui
 *
 * O backend publica `transitions` em cada orçamento — `canEdit`, `canSend`,
 * `canApprove`, `canReject`, `canCancel`, `canConvert`. A interface lê essa
 * resposta em vez de deduzir do status: deduzir criaria uma segunda máquina de
 * estados, e as duas divergiriam no primeiro estado novo. `QUOTE_STATUS_LABELS`
 * existe para **apresentar** o status, não para decidir nada com ele.
 *
 * ## Dinheiro é string
 *
 * `subtotal`, `discount`, `total` e todos os valores de item chegam como
 * string, pela mesma razão do Financeiro. A conversão para número acontece uma
 * vez, na formatação — nunca para somar.
 */
import type {
  QuoteItemReadModel,
  QuoteReadModel,
  QuoteSummaryReadModel,
  QuoteTransitionsReadModel,
} from "./contracts/modules/quotes/quote.read-models";
import type { QuoteStatus } from "./contracts";

export type { QuoteStatus };

/** Orçamento com itens (`GET /quotes/:id`). */
export type Quote = QuoteReadModel;

/** Item de listagem — sem `items` (`GET /quotes`). */
export type QuoteSummary = QuoteSummaryReadModel;

export type QuoteItem = QuoteItemReadModel;
export type QuoteTransitions = QuoteTransitionsReadModel;

/* -------------------------------------------------------------------- */
/* Consulta                                                              */
/* -------------------------------------------------------------------- */

/** `GET /quotes` (`QuoteQueryDto`). */
export interface QuoteQuery {
  search?: string;
  status?: QuoteStatus;
  customerId?: string;
  businessUnitId?: string;
  /** Criados a partir de (inclusive), `YYYY-MM-DD`. */
  from?: string;
  /** Criados até (inclusive), `YYYY-MM-DD`. */
  to?: string;
  /** Validade termina até esta data — o que vence primeiro. */
  validUntilBefore?: string;
  page?: number;
  limit?: number;
}

/* -------------------------------------------------------------------- */
/* Escritas                                                              */
/* -------------------------------------------------------------------- */

/**
 * `POST /quotes`.
 *
 * Sem status, número, itens ou valores: o orçamento nasce em `DRAFT`, vazio,
 * com numeração do servidor.
 */
export interface CreateQuoteInput {
  customerId: string;
  businessUnitId?: string;
  title: string;
  notes?: string;
  /** Parágrafo de abertura. Ausente imprime o padrão do documento. */
  introText?: string;
  validUntil?: string;
  currency?: string;
  /** Endereço de execução, entre os cadastrados do cliente. */
  serviceAddressId?: string;
  /** Quem assina. A sessão quando ausente. */
  responsibleUserId?: string;
  /** Equipamentos cobertos. Lista inteira, não incremental. */
  assetIds?: readonly string[];
}

/**
 * `POST /quotes/from-operation`.
 *
 * Copia cliente, endereço, equipamentos, título, descrição e os **materiais**
 * dos movimentos de consumo. Serviço com valor não é copiado: `Operation` não
 * guarda linha de serviço com preço, e inventá-la produziria valor numa proposta
 * que ninguém combinou.
 */
export interface CreateQuoteFromOperationInput {
  operationId: string;
  title?: string;
  validUntil?: string;
  responsibleUserId?: string;
}

/** `PATCH /quotes/:id`. Sem `customerId`: trocar o destinatário é outra proposta. */
export interface UpdateQuoteInput {
  title?: string;
  notes?: string;
  introText?: string;
  validUntil?: string;
  discount?: number;
  /** Por que houve desconto. Opcional: centavos para fechar a conta não pedem justificativa. */
  discountReason?: string;
  serviceAddressId?: string;
  responsibleUserId?: string;
  assetIds?: readonly string[];
}

/**
 * `POST /quotes/:id/items`.
 *
 * `catalogItemId` preenche descrição, SKU, unidade e preço; os campos
 * explícitos sobrepõem. Sem ele, `description` e `unitPrice` passam a ser
 * exigidos pelo servidor.
 */
export interface AddQuoteItemInput {
  catalogItemId?: string;
  description?: string;
  unit?: string;
  quantity: number;
  unitPrice?: number;
  discount?: number;
  notes?: string;
}

/** `PATCH /quotes/:id/items/:itemId`. A origem da fotografia não muda. */
export interface UpdateQuoteItemInput {
  description?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  discount?: number;
  notes?: string;
}

export interface QuoteReasonInput {
  reason: string;
}

/** `POST /quotes/:id/convert-to-operation`. */
export interface ConvertQuoteInput {
  kind?: string;
  priority?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
}

/* -------------------------------------------------------------------- */
/* Rótulos                                                               */
/* -------------------------------------------------------------------- */

export const QUOTE_STATUS_LABELS: Readonly<
  Record<QuoteStatus | string, string>
> = {
  DRAFT: "Em elaboração",
  SENT: "Enviado",
  APPROVED: "Aprovado",
  REJECTED: "Recusado",
  EXPIRED: "Expirado",
  CANCELLED: "Cancelado",
};

/**
 * Por que a proposta terminou assim.
 *
 * Os três desfechos negativos são **semanticamente distintos**, e a diferença
 * é comercial: recusado é decisão do cliente, expirado é prazo que passou,
 * cancelado é desistência de quem propôs. Tratá-los como um só apagaria a
 * informação que mais falta seis meses depois.
 */
export const QUOTE_STATUS_DESCRIPTIONS: Readonly<
  Record<QuoteStatus | string, string>
> = {
  DRAFT: "Ainda não foi enviado ao cliente. Aceita itens e edição.",
  SENT: "Está com o cliente, aguardando decisão. Não aceita mais alterações.",
  APPROVED: "O cliente aceitou. Gerou receita prevista no Financeiro.",
  REJECTED: "O cliente recusou a proposta.",
  EXPIRED: "A validade passou antes de haver decisão.",
  CANCELLED: "Foi retirado por quem propôs.",
};

/** Situações que encerram a proposta sem virar trabalho. */
export const QUOTE_CLOSED_STATUSES: readonly QuoteStatus[] = [
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
];

/** Tipo de operação aceito por `convert-to-operation`. */
export const OPERATION_KIND_LABELS: Readonly<Record<string, string>> = {
  INSTALLATION: "Instalação",
  MAINTENANCE: "Manutenção",
  INSPECTION: "Inspeção",
  DELIVERY: "Entrega",
  OTHER: "Outro",
};
