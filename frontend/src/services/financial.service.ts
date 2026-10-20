/**
 * Serviços do Financeiro — `/financial/**`.
 *
 * Um recurso, um caminho. As três leituras de Analytics ficam sob a mesma raiz
 * (`/financial/analytics/*`) porque é onde o backend as publica: elas exigem
 * capability financeira, e **não** `analytics.read`. Consumir `/analytics`
 * daqui daria a impressão de que faturamento sai de indicadores operacionais.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { PaginatedResult, QueryParams, RequestOptions } from "@/types/api";
import type { ArtifactExecution } from "@/types/artifact-executions";
import type {
  CancelFinancialEntryInput,
  ConfirmFinancialEntryInput,
  CreateFinancialCategoryInput,
  CreateFinancialEntryInput,
  CreateReceiptInput,
  FinancialAnalyticsQuery,
  FinancialCategory,
  FinancialCategoryBreakdown,
  FinancialCategoryQuery,
  FinancialEntry,
  FinancialEntryQuery,
  FinancialSettings,
  FinancialSummary,
  FinancialTimelinePoint,
  ReceiptSource,
  UpdateFinancialCategoryInput,
  UpdateFinancialEntryInput,
  UpdateFinancialSettingsInput,
} from "@/types/financial";

const FINANCIAL = "financial";
const PATH = "/financial";

const entry = (id: string): string =>
  `${PATH}/entries/${encodeURIComponent(id)}`;

const asParams = (query?: object): QueryParams | undefined =>
  query as QueryParams | undefined;

export const financialService = {
  keys: {
    entries: (query?: FinancialEntryQuery): QueryKey =>
      queryKeys.list(FINANCIAL, asParams(query)),
    entry: (id: string): QueryKey => queryKeys.detail(FINANCIAL, id),
    categories: (query?: FinancialCategoryQuery): QueryKey =>
      queryKeys.list(`${FINANCIAL}-categories`, asParams(query)),
    settings: (): QueryKey => queryKeys.module(`${FINANCIAL}-settings`),
    summary: (query?: FinancialAnalyticsQuery): QueryKey =>
      queryKeys.list(`${FINANCIAL}-summary`, asParams(query)),
    breakdown: (query?: FinancialAnalyticsQuery): QueryKey =>
      queryKeys.list(`${FINANCIAL}-breakdown`, asParams(query)),
    timeline: (query?: FinancialAnalyticsQuery): QueryKey =>
      queryKeys.list(`${FINANCIAL}-timeline`, asParams(query)),
    /** Raiz de tudo que uma escrita de lançamento pode ter mudado. */
    all: (): QueryKey => queryKeys.module(FINANCIAL),
    receiptSource: (operationId: string): QueryKey =>
      queryKeys.nested(`${FINANCIAL}-receipts`, operationId, "source"),
  },

  /* ---------------------------------------------------------------- */
  /* Recibos                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Emite um recibo — do zero ou a partir de um atendimento concluído.
   *
   * Devolve a execução de artefato em **rascunho**, com os campos preenchidos.
   * Renderizar é o passo seguinte, e é a publicação do manifesto que vira receita
   * confirmada no Financeiro.
   */
  createReceipt: (input: CreateReceiptInput): Promise<ArtifactExecution> =>
    apiClient.post<ArtifactExecution>(`${PATH}/receipts`, input),

  /** O atendimento de origem, com o que ele oferece preenchido. */
  receiptSource: (
    operationId: string,
    options?: RequestOptions,
  ): Promise<ReceiptSource> =>
    apiClient.get<ReceiptSource>(
      `${PATH}/receipts/sources/${encodeURIComponent(operationId)}`,
      options,
    ),

  /* ---------------------------------------------------------------- */
  /* Lançamentos                                                       */
  /* ---------------------------------------------------------------- */

  entries: (
    query?: FinancialEntryQuery,
    options?: RequestOptions,
  ): Promise<PaginatedResult<FinancialEntry>> =>
    apiClient.get<PaginatedResult<FinancialEntry>>(`${PATH}/entries`, {
      ...options,
      query: asParams(query),
    }),

  get: (id: string, options?: RequestOptions): Promise<FinancialEntry> =>
    apiClient.get<FinancialEntry>(entry(id), options),

  create: (input: CreateFinancialEntryInput): Promise<FinancialEntry> =>
    apiClient.post<FinancialEntry>(`${PATH}/entries`, input),

  /** Só lançamento manual: o servidor recusa editar origem automática. */
  update: (
    id: string,
    input: UpdateFinancialEntryInput,
  ): Promise<FinancialEntry> =>
    apiClient.patch<FinancialEntry>(entry(id), input),

  confirm: (
    id: string,
    input: ConfirmFinancialEntryInput = {},
  ): Promise<FinancialEntry> =>
    apiClient.post<FinancialEntry>(`${entry(id)}/confirm`, input),

  /**
   * Cancela — não exclui.
   *
   * `POST`, como no backend: o lançamento permanece com motivo, autor e data.
   * Um `DELETE` mentiria sobre o que acontece.
   */
  cancel: (
    id: string,
    input: CancelFinancialEntryInput,
  ): Promise<FinancialEntry> =>
    apiClient.post<FinancialEntry>(`${entry(id)}/cancel`, input),

  /* ---------------------------------------------------------------- */
  /* Categorias                                                        */
  /* ---------------------------------------------------------------- */

  categories: (
    query?: FinancialCategoryQuery,
    options?: RequestOptions,
  ): Promise<FinancialCategory[]> =>
    apiClient.get<FinancialCategory[]>(`${PATH}/categories`, {
      ...options,
      query: asParams(query),
    }),

  createCategory: (
    input: CreateFinancialCategoryInput,
  ): Promise<FinancialCategory> =>
    apiClient.post<FinancialCategory>(`${PATH}/categories`, input),

  updateCategory: (
    id: string,
    input: UpdateFinancialCategoryInput,
  ): Promise<FinancialCategory> =>
    apiClient.patch<FinancialCategory>(
      `${PATH}/categories/${encodeURIComponent(id)}`,
      input,
    ),

  removeCategory: (id: string): Promise<void> =>
    apiClient.delete<void>(`${PATH}/categories/${encodeURIComponent(id)}`),

  /* ---------------------------------------------------------------- */
  /* Analytics                                                         */
  /* ---------------------------------------------------------------- */

  summary: (
    query?: FinancialAnalyticsQuery,
    options?: RequestOptions,
  ): Promise<FinancialSummary> =>
    apiClient.get<FinancialSummary>(`${PATH}/analytics/summary`, {
      ...options,
      query: asParams(query),
    }),

  breakdown: (
    query?: FinancialAnalyticsQuery,
    options?: RequestOptions,
  ): Promise<FinancialCategoryBreakdown[]> =>
    apiClient.get<FinancialCategoryBreakdown[]>(
      `${PATH}/analytics/categories`,
      { ...options, query: asParams(query) },
    ),

  timeline: (
    query?: FinancialAnalyticsQuery,
    options?: RequestOptions,
  ): Promise<FinancialTimelinePoint[]> =>
    apiClient.get<FinancialTimelinePoint[]>(`${PATH}/analytics/timeline`, {
      ...options,
      query: asParams(query),
    }),

  /* ---------------------------------------------------------------- */
  /* Configuração                                                      */
  /* ---------------------------------------------------------------- */

  settings: (options?: RequestOptions): Promise<FinancialSettings> =>
    apiClient.get<FinancialSettings>(`${PATH}/settings`, options),

  updateSettings: (
    input: UpdateFinancialSettingsInput,
  ): Promise<FinancialSettings> =>
    apiClient.patch<FinancialSettings>(`${PATH}/settings`, input),
};
