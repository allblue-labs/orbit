/**
 * Serviços do Commercial Engine — `/quotes/**`.
 *
 * Cada transição tem endpoint próprio, como no backend. Não existe
 * `PATCH /quotes/:id/status` para chamar: enviar, aprovar, recusar e cancelar
 * registram coisas diferentes, e um método genérico aqui esconderia isso do
 * mesmo jeito que esconderia lá.
 *
 * **Toda escrita devolve o orçamento inteiro**, já recalculado pelo servidor.
 * É o que permite atualizar a tela com a resposta confirmada em vez de
 * remendar o estado local.
 */
import { apiClient } from "@/api/client";
import { downloadAndSave, type DownloadResult } from "@/api/transfer";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { PaginatedResult, QueryParams, RequestOptions } from "@/types/api";
import type { ArtifactExecution } from "@/types/artifact-executions";
import type {
  AddQuoteItemInput,
  ConvertQuoteInput,
  CreateQuoteFromOperationInput,
  CreateQuoteInput,
  Quote,
  QuoteQuery,
  QuoteReasonInput,
  QuoteSummary,
  UpdateQuoteInput,
  UpdateQuoteItemInput,
} from "@/types/quotes";

const QUOTES = "quotes";
const PATH = "/quotes";

const quote = (id: string): string => `${PATH}/${encodeURIComponent(id)}`;
const item = (id: string, itemId: string): string =>
  `${quote(id)}/items/${encodeURIComponent(itemId)}`;

const asParams = (query?: object): QueryParams | undefined =>
  query as QueryParams | undefined;

export const quotesService = {
  keys: {
    list: (query?: QuoteQuery): QueryKey =>
      queryKeys.list(QUOTES, asParams(query)),
    lists: (): QueryKey => queryKeys.lists(QUOTES),
    detail: (id: string): QueryKey => queryKeys.detail(QUOTES, id),
    all: (): QueryKey => queryKeys.module(QUOTES),
  },

  list: (
    query?: QuoteQuery,
    options?: RequestOptions,
  ): Promise<PaginatedResult<QuoteSummary>> =>
    apiClient.get<PaginatedResult<QuoteSummary>>(PATH, {
      ...options,
      query: asParams(query),
    }),

  get: (id: string, options?: RequestOptions): Promise<Quote> =>
    apiClient.get<Quote>(quote(id), options),

  create: (input: CreateQuoteInput): Promise<Quote> =>
    apiClient.post<Quote>(PATH, input),

  /**
   * A proposta copiada de um atendimento concluído.
   *
   * Rota própria porque são duas operações diferentes com a mesma aparência:
   * criar recebe os dados, copiar **lê** um registro que já existe.
   */
  createFromOperation: (input: CreateQuoteFromOperationInput): Promise<Quote> =>
    apiClient.post<Quote>(`${PATH}/from-operation`, input),

  update: (id: string, input: UpdateQuoteInput): Promise<Quote> =>
    apiClient.patch<Quote>(quote(id), input),

  /** Só rascunho. Proposta enviada é cancelada, não apagada. */
  remove: (id: string): Promise<void> => apiClient.delete<void>(quote(id)),

  /* ---------------------------------------------------------------- */
  /* Itens                                                             */
  /* ---------------------------------------------------------------- */

  addItem: (id: string, input: AddQuoteItemInput): Promise<Quote> =>
    apiClient.post<Quote>(`${quote(id)}/items`, input),

  updateItem: (
    id: string,
    itemId: string,
    input: UpdateQuoteItemInput,
  ): Promise<Quote> => apiClient.patch<Quote>(item(id, itemId), input),

  removeItem: (id: string, itemId: string): Promise<Quote> =>
    apiClient.delete<Quote>(item(id, itemId)),

  /* ---------------------------------------------------------------- */
  /* Transições                                                        */
  /* ---------------------------------------------------------------- */

  send: (id: string): Promise<Quote> =>
    apiClient.post<Quote>(`${quote(id)}/send`, {}),

  /** Aprovar gera receita **prevista** no Financeiro, nunca realizada. */
  approve: (id: string): Promise<Quote> =>
    apiClient.post<Quote>(`${quote(id)}/approve`, {}),

  reject: (id: string, input: QuoteReasonInput): Promise<Quote> =>
    apiClient.post<Quote>(`${quote(id)}/reject`, input),

  cancel: (id: string, input: QuoteReasonInput): Promise<Quote> =>
    apiClient.post<Quote>(`${quote(id)}/cancel`, input),

  /** Idempotente no servidor: repetir devolve a mesma operação. */
  convert: (id: string, input: ConvertQuoteInput = {}): Promise<Quote> =>
    apiClient.post<Quote>(`${quote(id)}/convert-to-operation`, input),

  /* ---------------------------------------------------------------- */
  /* Documento                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Baixa a proposta impressa.
   *
   * Desenhada na hora, do estado atual — não passa pela fila nem abre revisão,
   * porque um orçamento é editado enquanto é rascunho e cada reimpressão viraria
   * versão de um documento que ninguém executou.
   *
   * O nome do arquivo vem do `Content-Disposition`: é o servidor que decide como
   * o arquivo se chama, e montar `ORC-000042.pdf` aqui duplicaria essa regra.
   */
  document: (id: string): Promise<DownloadResult> =>
    downloadAndSave(`${quote(id)}/document`),

  /**
   * Emitir o documento oficial da proposta.
   *
   * Devolve a **execução de artefato** criada, não um arquivo: emitir cria o
   * documento com código e revisão, e a assinatura do proponente acontece na tela
   * da execução. É o mesmo desenho do recibo — a chamada cria, a tela conclui.
   */
  issueDocument: (id: string): Promise<ArtifactExecution> =>
    apiClient.post<ArtifactExecution>(`${quote(id)}/document/issue`, {}),
};
