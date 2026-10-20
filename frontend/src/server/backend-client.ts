/**
 * Cliente HTTP servidor → NestJS.
 *
 * É o **único** ponto do frontend que conhece a URL do backend. Route
 * Handlers, middleware e Server Components passam por aqui; o browser jamais
 * alcança o NestJS diretamente.
 */
import { ApiError, parseErrorEnvelope, toApiError } from "@/lib/api-error";
import { DEFAULT_TIMEOUT_MS, assertServer, backendUrl } from "@/lib/env";
import {
  defaultRetriesFor,
  isRetryableError,
  parseRetryAfter,
  retryDelay,
  wait,
} from "@/lib/retry";
import type { ApiEnvelope, HttpMethod, QueryParams } from "@/types/api";
import {
  combineSignals,
  isJsonResponse,
  normalizePath,
  serializeQuery,
} from "@/utils/http";
import {
  backendContextHeaders,
  type BackendContextInput,
} from "./request-context";

export interface BackendRequest extends BackendContextInput {
  path: string;
  method?: HttpMethod;
  query?: QueryParams;
  /** Query string já pronta (com `?`). Tem precedência sobre `query`. */
  search?: string;
  headers?: Readonly<Record<string, string>>;
  body?: BodyInit | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: number;
  /**
   * Quantos segundos a resposta pode ser reaproveitada.
   *
   * Ausente significa `no-store`, que é o certo para tudo o que depende de
   * quem está pedindo: dado de inquilino não se compartilha entre requisições,
   * e um cache aqui serviria a resposta de uma organização para outra.
   *
   * Só leitura **pública e igual para todo mundo** deve usar isto — hoje, o
   * catálogo comercial de planos. É o que permite a landing e a página de
   * preços serem servidas sem uma ida ao backend por visita.
   */
  revalidateSeconds?: number;
}

/**
 * Executa a chamada e devolve a `Response` bruta — usada pelo proxy do BFF,
 * que precisa repassar streams binários sem materializá-los.
 */
export async function backendFetch(request: BackendRequest): Promise<Response> {
  assertServer("backendFetch");
  const method = request.method ?? "GET";
  const search = request.search ?? serializeQuery(request.query);
  const url = `${backendUrl(normalizePath(request.path))}${search}`;
  const headers = {
    ...backendContextHeaders(request),
    ...request.headers,
  };
  const maxRetries = request.retries ?? defaultRetriesFor(method);

  let attempt = 0;
  for (;;) {
    const timeout = AbortSignal.timeout(
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const { signal, dispose } = combineSignals([request.signal, timeout]);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: request.body ?? undefined,
        ...(request.revalidateSeconds === undefined
          ? { cache: "no-store" as const }
          : { next: { revalidate: request.revalidateSeconds } }),
        redirect: "manual",
        signal,
      });
      if (response.ok || attempt >= maxRetries) return response;
      const transient = new ApiError({
        kind: "http",
        message: `HTTP ${response.status}`,
        status: response.status,
      });
      if (!isRetryableError(transient)) return response;
      const delay = retryDelay(
        attempt,
        parseRetryAfter(response.headers.get("retry-after")),
      );
      await response.body?.cancel();
      await wait(delay, request.signal);
    } catch (error) {
      const apiError = toApiError(error);
      if (attempt >= maxRetries || !isRetryableError(apiError)) throw apiError;
      await wait(retryDelay(attempt), request.signal);
    } finally {
      dispose();
    }
    attempt += 1;
  }
}

/**
 * Executa a chamada, desembrulha o envelope `{ success, data }` e converte
 * qualquer falha em `ApiError`.
 */
export async function backendJson<T>(request: BackendRequest): Promise<T> {
  const response = await backendFetch({
    ...request,
    headers: {
      accept: "application/json",
      ...(request.body !== undefined && request.body !== null
        ? { "content-type": "application/json" }
        : {}),
      ...request.headers,
    },
  });
  return unwrapEnvelope<T>(response);
}

/** Serializa um corpo JSON preservando `undefined` como ausência de corpo. */
export function jsonBody(payload: unknown): BodyInit | null {
  return payload === undefined ? null : JSON.stringify(payload);
}

/** Interpreta a resposta do backend: `data` no sucesso, `ApiError` na falha. */
export async function unwrapEnvelope<T>(response: Response): Promise<T> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }
  const payload: unknown = isJsonResponse(response)
    ? await response.json().catch(() => null)
    : await response.text().catch(() => null);

  if (!response.ok) {
    const parsed = parseErrorEnvelope(payload);
    throw new ApiError({
      kind: "http",
      status: response.status,
      message: parsed.message,
      code: parsed.code,
      requestId: parsed.requestId ?? requestId,
      details: parsed.details,
    });
  }
  return extractData<T>(payload);
}

function extractData<T>(payload: unknown): T {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "success" in payload &&
    "data" in payload
  ) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
}
