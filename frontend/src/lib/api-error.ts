/**
 * Erros normalizados da API — compartilhados entre servidor e browser.
 *
 * Toda falha de rede, timeout, cancelamento ou resposta não-2xx chega às
 * camadas superiores como `ApiError`, com `status`, `code` e `requestId`
 * preenchidos sempre que o backend os fornecer.
 */
import type { ApiErrorEnvelope } from "@/types/api";

export type ApiErrorKind = "http" | "network" | "timeout" | "aborted" | "parse";

export interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  code?: string;
  requestId?: string;
  details?: unknown;
  cause?: unknown;
}

const FALLBACK_MESSAGE = "Não foi possível concluir a solicitação.";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(init: ApiErrorInit) {
    super(init.message || FALLBACK_MESSAGE, { cause: init.cause });
    this.name = "ApiError";
    this.kind = init.kind;
    this.status = init.status ?? 0;
    this.code = init.code ?? defaultCode(init.kind, init.status);
    this.requestId = init.requestId ?? null;
    this.details = init.details;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isValidation(): boolean {
    return this.status === 400 || this.status === 422;
  }

  get isServer(): boolean {
    return this.status >= 500;
  }

  get isAborted(): boolean {
    return this.kind === "aborted";
  }

  /** Mensagens seguras do contrato estruturado de validação. */
  get validationMessages(): readonly string[] {
    if (Array.isArray(this.details)) {
      return this.details.flatMap((item) => {
        if (typeof item === "string") return [item];
        if (
          typeof item === "object" &&
          item !== null &&
          "message" in item &&
          typeof item.message === "string"
        ) {
          return [item.message];
        }
        return [];
      });
    }
    return [];
  }

  toJSON(): ApiErrorEnvelope {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        status: this.status,
        details: this.details,
      },
      requestId: this.requestId ?? "unknown",
      timestamp: new Date().toISOString(),
    };
  }
}

function defaultCode(kind: ApiErrorKind, status?: number): string {
  if (kind !== "http") return kind.toUpperCase();
  if (!status) return "HTTP_ERROR";
  if (status === 401) return "UNAUTHORIZED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "CONFLICT";
  if (status === 429) return "TOO_MANY_REQUESTS";
  return status >= 500 ? "INTERNAL_SERVER_ERROR" : "HTTP_ERROR";
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Converte qualquer exceção em `ApiError` sem perder a causa original. */
export function toApiError(error: unknown, fallbackMessage?: string): ApiError {
  if (isApiError(error)) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new ApiError({
      kind: "aborted",
      message: "Requisição cancelada.",
      cause: error,
    });
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ApiError({
      kind: "timeout",
      message: "A requisição excedeu o tempo limite.",
      cause: error,
    });
  }
  return new ApiError({
    kind: "network",
    message:
      fallbackMessage ??
      (error instanceof Error ? error.message : FALLBACK_MESSAGE),
    cause: error,
  });
}

/** Interpreta o corpo de erro do backend (`FoundationExceptionFilter`). */
export function parseErrorEnvelope(payload: unknown): {
  message: string;
  code?: string;
  requestId?: string;
  details?: unknown;
} {
  if (typeof payload !== "object" || payload === null) {
    return { message: FALLBACK_MESSAGE };
  }
  const body = payload as Partial<ApiErrorEnvelope> & {
    message?: string | string[];
  };
  const error = body.error;
  const rawMessage = error?.message ?? body.message;
  const message = Array.isArray(rawMessage)
    ? rawMessage.join(" ")
    : (rawMessage ?? FALLBACK_MESSAGE);
  return {
    message,
    code: error?.code,
    requestId: typeof body.requestId === "string" ? body.requestId : undefined,
    details:
      error?.details ?? (Array.isArray(rawMessage) ? rawMessage : undefined),
  };
}

export { FALLBACK_MESSAGE };
