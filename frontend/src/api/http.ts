/**
 * Cliente HTTP do browser → BFF.
 *
 * Nunca aponta para o NestJS: todas as URLs são relativas a `/api/orbit`, o
 * que mantém os tokens em cookies `HttpOnly` e evita CORS.
 *
 * Aplica, em toda chamada: contexto multi-tenant, `requestId`, timeout com
 * `AbortController`, retry com backoff em falhas transitórias e conversão de
 * qualquer erro em `ApiError`.
 */
import { ApiError, parseErrorEnvelope, toApiError } from "@/lib/api-error";
import { BFF_BASE_PATH, DEFAULT_TIMEOUT_MS, isServer } from "@/lib/env";
import {
  defaultRetriesFor,
  isRetryableError,
  parseRetryAfter,
  retryDelay,
  wait,
} from "@/lib/retry";
import { CONTEXT_HEADERS } from "@/lib/context-headers";
import type { ApiEnvelope, HttpMethod, RequestOptions } from "@/types/api";
import {
  combineSignals,
  isJsonResponse,
  normalizePath,
  serializeQuery,
} from "@/utils/http";
import { resolveRequestContext } from "./request-context";

export interface HttpRequest extends RequestOptions {
  method: HttpMethod;
  path: string;
  /** JSON (serializado) ou `FormData`/`Blob` repassado como está. */
  body?: unknown;
  /** Base alternativa — usada pelas rotas de autenticação (`/api/auth`). */
  basePath?: string;
}

const BODYLESS_METHODS: readonly HttpMethod[] = ["GET", "HEAD"];

function assertBrowser(): void {
  if (isServer()) {
    throw new ApiError({
      kind: "network",
      message:
        "apiClient é exclusivo do browser. Em Server Components use serverApi (@/server/api).",
      code: "SERVER_CONTEXT",
    });
  }
}

function buildHeaders(request: HttpRequest): Headers {
  const context = resolveRequestContext(request.context);
  const headers = new Headers({
    accept: "application/json",
    [CONTEXT_HEADERS.requestId]: context.requestId,
    [CONTEXT_HEADERS.locale]: context.locale,
    [CONTEXT_HEADERS.timezone]: context.timezone,
  });
  if (context.organizationId) {
    headers.set(CONTEXT_HEADERS.organizationId, context.organizationId);
  }
  if (context.businessUnitId) {
    headers.set(CONTEXT_HEADERS.businessUnitId, context.businessUnitId);
  }
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers.set(name, value);
  }
  return headers;
}

function buildBody(request: HttpRequest, headers: Headers): BodyInit | null {
  if (BODYLESS_METHODS.includes(request.method) || request.body === undefined) {
    return null;
  }
  if (
    request.body instanceof FormData ||
    request.body instanceof Blob ||
    request.body instanceof ArrayBuffer ||
    request.body instanceof URLSearchParams
  ) {
    /** O browser define o `content-type` (com boundary) para FormData. */
    return request.body;
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return JSON.stringify(request.body);
}

/** Executa a requisição e devolve a `Response` bruta. */
export async function httpRequest(request: HttpRequest): Promise<Response> {
  assertBrowser();
  const headers = buildHeaders(request);
  const body = buildBody(request, headers);
  const base = request.basePath ?? BFF_BASE_PATH;
  const url = `${base}${normalizePath(request.path)}${serializeQuery(request.query)}`;
  const maxRetries = request.retries ?? defaultRetriesFor(request.method);

  let attempt = 0;
  for (;;) {
    const timeout = AbortSignal.timeout(
      request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const { signal, dispose } = combineSignals([request.signal, timeout]);
    try {
      const response = await fetch(url, {
        method: request.method,
        headers,
        body,
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (response.ok || attempt >= maxRetries) return response;
      const transient = new ApiError({
        kind: "http",
        message: `HTTP ${response.status}`,
        status: response.status,
      });
      if (!isRetryableError(transient)) return response;
      await response.body?.cancel();
      await wait(
        retryDelay(
          attempt,
          parseRetryAfter(response.headers.get("retry-after")),
        ),
        request.signal,
      );
    } catch (error) {
      const apiError = toApiError(error, "Não foi possível conectar. Verifique sua conexão.");
      if (attempt >= maxRetries || !isRetryableError(apiError)) throw apiError;
      await wait(retryDelay(attempt), request.signal);
    } finally {
      dispose();
    }
    attempt += 1;
  }
}

/** Executa a requisição e devolve `data` já desembrulhado do envelope. */
export async function httpJson<T>(request: HttpRequest): Promise<T> {
  const response = await httpRequest(request);
  return readEnvelope<T>(response);
}

export async function readEnvelope<T>(response: Response): Promise<T> {
  const requestId =
    response.headers.get(CONTEXT_HEADERS.requestId) ?? undefined;
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
