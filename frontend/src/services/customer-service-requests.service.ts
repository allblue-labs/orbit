/**
 * Os chamados dos clientes, do lado da equipe.
 *
 * Espelho de `CustomerServiceRequestInternalController`. As ações que a tela
 * oferece são as `allowedActions` de cada chamado — a máquina de estados é do
 * servidor, e a tela não a reimplementa.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { QueryParams, RequestOptions } from "@/types/api";
import type {
  CustomerServiceRequestDetailsReadModel as ServiceRequest,
  CustomerServiceRequestPageReadModel as ServiceRequestPage,
} from "@/types/contracts/modules/customer-service-requests/customer-service-request.read-models";

const RESOURCE = "customer-service-requests";
const BASE = "/customer-service-requests";
const item = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export interface ServiceRequestQuery {
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const customerServiceRequestsService = {
  keys: {
    all: (): QueryKey => queryKeys.module(RESOURCE),
    list: (query?: ServiceRequestQuery): QueryKey =>
      queryKeys.list(RESOURCE, query as QueryParams | undefined),
    detail: (id: string): QueryKey => queryKeys.detail(RESOURCE, id),
  },
  list: (query?: ServiceRequestQuery, options?: RequestOptions) =>
    apiClient.get<ServiceRequestPage>(BASE, {
      ...options,
      query: query as QueryParams | undefined,
    }),
  get: (id: string, options?: RequestOptions) =>
    apiClient.get<ServiceRequest>(item(id), options),
  triage: (id: string, expectedVersion: number) =>
    apiClient.post<ServiceRequest>(`${item(id)}/triage`, { expectedVersion }),
  assign: (id: string, expectedVersion: number, userId: string) =>
    apiClient.post<ServiceRequest>(`${item(id)}/assign`, {
      expectedVersion,
      userId,
    }),
  status: (id: string, expectedVersion: number, status: string, message?: string) =>
    apiClient.post<ServiceRequest>(`${item(id)}/status`, {
      expectedVersion,
      status,
      ...(message ? { message } : {}),
    }),
  publicResponse: (id: string, expectedVersion: number, message: string) =>
    apiClient.post<ServiceRequest>(`${item(id)}/public-responses`, {
      expectedVersion,
      message,
    }),
  internalNote: (id: string, expectedVersion: number, message: string) =>
    apiClient.post<ServiceRequest>(`${item(id)}/internal-notes`, {
      expectedVersion,
      message,
    }),
  convert: (
    id: string,
    idempotencyKey: string,
    input: {
      expectedVersion: number;
      businessUnitId: string;
      code: string;
      kind: string;
      title: string;
      description?: string;
    },
  ) =>
    apiClient.post<ServiceRequest>(`${item(id)}/create-operation`, input, {
      headers: { "idempotency-key": idempotencyKey },
    }),
};
