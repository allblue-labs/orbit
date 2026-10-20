/**
 * Serviços da comissão — `/commissions/**`.
 *
 * A comissão é financeira (exige `financial.read` / `financial.manage`) e tem
 * raiz própria porque é um controller próprio no backend: lê atendimento,
 * técnico e receita, e não é lançamento do Financeiro.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { QueryParams, RequestOptions } from "@/types/api";
import type {
  CancelCommissionInput,
  Commission,
  CommissionOverview,
  CommissionPayment,
  CommissionPaymentQuery,
  CommissionListQuery,
  CommissionPolicy,
  CommissionQuery,
  CommissionWindow,
  PayCommissionsInput,
  SaveCommissionPolicyInput,
} from "@/types/commissions";

const RESOURCE = "commissions";
const PATH = "/commissions";

const asParams = (query?: object): QueryParams | undefined =>
  query as QueryParams | undefined;

export interface CommissionListResult {
  window: CommissionWindow;
  policy: CommissionPolicy;
  commissions: Commission[];
}

export const commissionsService = {
  keys: {
    policy: (): QueryKey => queryKeys.module(`${RESOURCE}-policy`),
    overview: (query?: CommissionQuery): QueryKey =>
      queryKeys.list(`${RESOURCE}-overview`, asParams(query)),
    list: (query?: CommissionListQuery): QueryKey =>
      queryKeys.list(RESOURCE, asParams(query)),
    payments: (query?: CommissionPaymentQuery): QueryKey =>
      queryKeys.list(`${RESOURCE}-payments`, asParams(query)),
    /** Raiz de tudo que um pagamento ou uma política pode ter mudado. */
    all: (): QueryKey => queryKeys.module(RESOURCE),
  },

  policy: (options?: RequestOptions): Promise<CommissionPolicy> =>
    apiClient.get<CommissionPolicy>(`${PATH}/policy`, options),

  savePolicy: (
    input: SaveCommissionPolicyInput,
    options?: RequestOptions,
  ): Promise<CommissionPolicy> =>
    apiClient.put<CommissionPolicy>(`${PATH}/policy`, input, options),

  overview: (
    query?: CommissionQuery,
    options?: RequestOptions,
  ): Promise<CommissionOverview> =>
    apiClient.get<CommissionOverview>(`${PATH}/overview`, {
      ...options,
      query: asParams(query),
    }),

  list: (
    query?: CommissionListQuery,
    options?: RequestOptions,
  ): Promise<CommissionListResult> =>
    apiClient.get<CommissionListResult>(PATH, {
      ...options,
      query: asParams(query),
    }),

  payments: (
    query?: CommissionPaymentQuery,
    options?: RequestOptions,
  ): Promise<CommissionPayment[]> =>
    apiClient.get<CommissionPayment[]>(`${PATH}/payments`, {
      ...options,
      query: asParams(query),
    }),

  pay: (
    input: PayCommissionsInput,
    options?: RequestOptions,
  ): Promise<CommissionPayment> =>
    apiClient.post<CommissionPayment>(`${PATH}/payments`, input, options),

  /** Decide não pagar. Devolve a comissão já com a situação nova. */
  cancel: (
    input: CancelCommissionInput,
    options?: RequestOptions,
  ): Promise<Commission> =>
    apiClient.post<Commission>(`${PATH}/cancellations`, input, options),

  /**
   * Desfaz a decisão.
   *
   * `POST` e não `DELETE`: registra uma segunda decisão, e a primeira fica no
   * histórico com quem a desfez.
   */
  restore: (
    input: CancelCommissionInput,
    options?: RequestOptions,
  ): Promise<Commission> =>
    apiClient.post<Commission>(
      `${PATH}/cancellations/revocations`,
      input,
      options,
    ),
} as const;
