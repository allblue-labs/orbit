/**
 * Tipos de transporte da API do Orbit.
 *
 * O formato de envelope é definido pelo backend em
 * `backend/src/interceptors/foundation.interceptors.ts` (sucesso) e
 * `backend/src/common/foundation-exception.filter.ts` (erro).
 */
import type {
  ICursorResult,
  IPaginatedResult,
  IBaseResponse,
} from "./contracts";

/** Envelope de sucesso: `{ success, data, requestId, timestamp }`. */
export type ApiEnvelope<T> = IBaseResponse<T>;

/** Corpo de erro produzido pelo `FoundationExceptionFilter`. */
export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
  };
  requestId: string;
  timestamp: string;
}

/** Resultado paginado por página (`{ data, meta }`). */
export type PaginatedResult<T> = IPaginatedResult<T>;

/** Resultado paginado por cursor (`{ data, nextCursor, hasNextPage }`). */
export type CursorResult<T> = ICursorResult<T>;

/** Query padrão de listagem aceita pelos controllers paginados. */
export interface PaginationQuery {
  page?: number;
  limit?: number;
}

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Valor primitivo aceito em query strings. */
export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | ReadonlyArray<string | number | boolean>;

export type QueryParams = Readonly<Record<string, QueryValue>>;

/** Contexto multi-tenant propagado em toda requisição. */
export interface OrbitRequestContext {
  organizationId: string | null;
  businessUnitId: string | null;
  requestId: string;
  locale: string;
  timezone: string;
}

/** Opções aceitas por todos os métodos do cliente HTTP. */
export interface RequestOptions {
  /** Query string. Valores `null`/`undefined` são omitidos. */
  query?: QueryParams;
  /** Cabeçalhos adicionais (o contexto padrão é aplicado automaticamente). */
  headers?: Readonly<Record<string, string>>;
  /** Cancelamento externo — combinado com o timeout interno. */
  signal?: AbortSignal;
  /** Timeout em milissegundos. Padrão: `DEFAULT_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Número máximo de novas tentativas. Padrão: métodos idempotentes = 2. */
  retries?: number;
  /** Sobrescreve o contexto multi-tenant desta requisição. */
  context?: Partial<OrbitRequestContext>;
}

export interface RequestOptionsWithBody extends RequestOptions {
  /** Corpo JSON. Use `apiClient.upload` para `multipart/form-data`. */
  body?: unknown;
}
