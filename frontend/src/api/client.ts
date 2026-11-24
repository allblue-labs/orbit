/**
 * `apiClient` — superfície pública de acesso à API no browser.
 *
 * ```ts
 * const page = await apiClient.get<PaginatedResult<Operation>>("/operations", {
 *   query: { page: 1, limit: 20, status: "OPEN" },
 *   signal,
 * });
 * ```
 *
 * Todos os métodos: aplicam o contexto multi-tenant, aceitam `AbortSignal`,
 * desembrulham o envelope do backend e lançam `ApiError` em qualquer falha.
 */
import { BFF_AUTH_PATH } from "@/lib/env";
import type { RequestOptions } from "@/types/api";
import { httpJson, httpRequest } from "./http";

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> =>
    httpJson<T>({ method: "GET", path, ...options }),

  post: <T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> => httpJson<T>({ method: "POST", path, body, ...options }),

  /** Same key for each network attempt of a mutation that supports replay. */
  postIdempotent: <T>(path: string, body: unknown): Promise<T> => {
    const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return httpJson<T>({
      method: "POST",
      path,
      body,
      headers: { "idempotency-key": key },
      retries: 1,
    });
  },

  put: <T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> => httpJson<T>({ method: "PUT", path, body, ...options }),

  patch: <T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> => httpJson<T>({ method: "PATCH", path, body, ...options }),

  delete: <T = void>(path: string, options?: RequestOptions): Promise<T> =>
    httpJson<T>({ method: "DELETE", path, ...options }),

  /** Response bruta — use para streams e downloads. */
  raw: (
    path: string,
    options?: RequestOptions & { method?: "GET" | "POST" },
  ): Promise<Response> =>
    httpRequest({ method: options?.method ?? "GET", path, ...options }),
} as const;

/** Cliente das rotas de autenticação (`/api/auth/*`), fora do proxy genérico. */
export const authClient = {
  post: <T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> =>
    httpJson<T>({
      method: "POST",
      path,
      body,
      basePath: BFF_AUTH_PATH,
      retries: 0,
      ...options,
    }),

  get: <T>(path: string, options?: RequestOptions): Promise<T> =>
    httpJson<T>({ method: "GET", path, basePath: BFF_AUTH_PATH, ...options }),
} as const;
