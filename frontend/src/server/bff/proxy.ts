import { readBffBody, BffBodyError } from "./request-body";
/**
 * Proxy do BFF: `/api/orbit/**` → NestJS.
 *
 * Responsabilidades:
 * - autenticar a chamada com o access token guardado em cookie `HttpOnly`;
 * - renovar o par de tokens em caso de 401 e reexecutar a requisição uma vez;
 * - propagar o contexto (`requestId`, `locale`, `timezone`, escopo);
 * - repassar corpos binários (upload/download) sem materializar arquivos;
 * - devolver erros no mesmo envelope do backend.
 *
 * Nenhum módulo de negócio precisa criar Route Handlers próprios: basta
 * chamar `/api/orbit/<rota-do-backend>` pelo cliente em `@/api`.
 */
import { logProxy } from "./proxy-telemetry";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { toApiError } from "@/lib/api-error";
import { withClientOrigin } from "@/server/trusted-client-origin";
import { backendFetch } from "@/server/backend-client";
import {
  endSession,
  persistSession,
  readStoredTokens,
  refreshTokens,
  resolveAccess,
} from "@/server/auth/session";
import { CONTEXT_HEADERS } from "@/lib/context-headers";
import { readContextFromRequest } from "@/server/request-context";
import { inspectPath } from "./allowlist";
import { bffError, isSameOriginRequest } from "./responses";
import type { HttpMethod } from "@/types/api";
import type { TokenPair } from "@/types/session";
import { buildSafePath } from "@/utils/http";

/** Cabeçalhos do browser repassados ao backend. */
const FORWARDED_REQUEST_HEADERS: readonly string[] = [
  "accept",
  "content-type",
  "idempotency-key",
  "if-none-match",
  "if-modified-since",
];

/**
 * Cabeçalhos do backend devolvidos ao browser. `content-length` e
 * `content-encoding` ficam de fora: o `fetch` já descomprime o corpo e os
 * valores originais deixariam de corresponder ao que trafega.
 */
const FORWARDED_RESPONSE_HEADERS: readonly string[] = [
  "content-type",
  "content-disposition",
  "vary",
  "etag",
  "last-modified",
  "location",
  "x-content-type-options",
  "x-document-sha256",
  "x-correlation-id",
  "x-request-id",
  "retry-after",
];

const METHODS_WITH_BODY: readonly HttpMethod[] = ["POST", "PUT", "PATCH"];

export interface ProxyRouteContext {
  params: Promise<{ path?: string[] }>;
}

export async function proxyToBackend(
  request: NextRequest,
  context: ProxyRouteContext,
): Promise<Response> {
  const requestContext = readContextFromRequest(request);
  const started = performance.now();
  return withClientOrigin(
    request,
    async () => {
      let status = 503;
      let identity:
        { userId: string; organizationId: string | null } | undefined;
      try {
        const response = await proxyWithOrigin(
          request,
          context,
          requestContext,
          (actor) => {
            identity = actor;
          },
        );
        status = response.status;
        return response;
      } catch (error) {
        const apiError = toApiError(error);
        status =
          error instanceof BffBodyError
            ? error.status
            : apiError.status === 429
              ? 429
              : 503;
        return bffError({
          status,
          code: apiError.code,
          message: apiError.message,
          requestId: requestContext.requestId,
          details: apiError.details,
        });
      } finally {
        logProxy(
          request,
          "orbit",
          requestContext.requestId,
          performance.now() - started,
          status,
          identity,
        );
      }
    },
    requestContext.requestId,
  );
}

async function proxyWithOrigin(
  request: NextRequest,
  context: ProxyRouteContext,
  requestContext: ReturnType<typeof readContextFromRequest>,
  authenticated: (actor: {
    userId: string;
    organizationId: string | null;
  }) => void,
): Promise<Response> {
  const { requestId } = requestContext;

  if (!isSameOriginRequest(request)) {
    return bffError({
      status: 403,
      code: "FORBIDDEN_ORIGIN",
      message: "Origem da solicitação não permitida.",
      requestId,
    });
  }

  const { path: segments = [] } = await context.params;
  const path = buildSafePath(segments);
  if (!path) {
    return bffError({
      status: 400,
      code: "INVALID_PATH",
      message: "Caminho de API inválido.",
      requestId,
    });
  }

  const method = request.method.toUpperCase() as HttpMethod;
  const verdict = inspectPath(path, method);
  if (!verdict.allowed) {
    return bffError({
      status: verdict.status,
      code: verdict.status === 404 ? "NOT_FOUND" : "FORBIDDEN",
      message: verdict.message,
      requestId,
    });
  }

  const access = await resolveAccess({ allowRefresh: true, requestId });
  if (verdict.requiresSession && (!access.accessToken || !access.claims)) {
    const response = bffError({
      status: 401,
      code: "SESSION_EXPIRED",
      message: "Sessão expirada. Faça login novamente.",
      requestId,
    });
    if (access.expired) endSession(response.cookies);
    return response;
  }

  let retained: { body: ArrayBuffer | null; release: () => void } = {
    body: null,
    release: () => undefined,
  };
  let rotated: TokenPair | null = access.rotated;
  let accessToken = access.accessToken;

  try {
    // Retain bounded bytes throughout the token-refresh retry.
    if (METHODS_WITH_BODY.includes(method))
      retained = await readBffBody(request);
    const body = retained.body;
    let upstream = await forward({
      request,
      requestContext,
      path,
      method,
      body,
      accessToken,
      organizationId: access.claims?.organizationId ?? null,
      businessUnitId: access.claims?.businessUnitId ?? null,
    });

    /** Endpoints públicos não têm sessão para renovar. */
    if (upstream.status === 401 && verdict.requiresSession) {
      const { refreshToken } = await readStoredTokens();
      const renewed = refreshToken
        ? await refreshTokens(refreshToken, requestId)
        : null;
      if (!renewed) {
        await upstream.body?.cancel();
        const response = bffError({
          status: 401,
          code: "SESSION_EXPIRED",
          message: "Sessão expirada. Faça login novamente.",
          requestId,
        });
        endSession(response.cookies);
        return response;
      }
      await upstream.body?.cancel();
      rotated = renewed;
      accessToken = renewed.accessToken;
      upstream = await forward({
        request,
        requestContext,
        path,
        method,
        body,
        accessToken,
        organizationId: access.claims?.organizationId ?? null,
        businessUnitId: access.claims?.businessUnitId ?? null,
      });
    }

    if (verdict.requiresSession && access.claims && upstream.status < 400) {
      authenticated({
        userId: access.claims.sub,
        organizationId: access.claims.organizationId,
      });
    }
    const response = buildResponse(upstream, requestId);
    if (rotated) persistSession(response.cookies, rotated);
    return response;
  } catch (error) {
    const apiError = toApiError(error);
    const response = bffError({
      status:
        error instanceof BffBodyError
          ? error.status
          : apiError.status === 429
            ? 429
            : apiError.kind === "timeout"
              ? 504
              : 502,
      code: apiError.code,
      message: apiError.message,
      details: apiError.details,
      requestId,
    });
    if (error instanceof BffBodyError)
      response.headers.set("Connection", "close");
    if (rotated) persistSession(response.cookies, rotated);
    return response;
  } finally {
    retained.release();
  }
}

interface ForwardInput {
  request: NextRequest;
  requestContext: ReturnType<typeof readContextFromRequest>;
  path: string;
  method: HttpMethod;
  body: ArrayBuffer | null;
  /** Ausente apenas nos endpoints públicos. */
  accessToken: string | null;
  organizationId: string | null;
  businessUnitId: string | null;
}

function forward(input: ForwardInput): Promise<Response> {
  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = input.request.headers.get(name);
    if (value) headers[name] = value;
  }
  return backendFetch({
    method: input.method,
    path: input.path,
    search: input.request.nextUrl.search,
    headers,
    body: input.body,
    accessToken: input.accessToken,
    requestId: input.requestContext.requestId,
    locale: input.requestContext.locale,
    timezone: input.requestContext.timezone,
    organizationId: input.requestContext.organizationId ?? input.organizationId,
    businessUnitId: input.requestContext.businessUnitId ?? input.businessUnitId,
    /** O retry idempotente do BFF é desligado: quem decide é o cliente. */
    retries: 0,
    signal: input.request.signal,
    ...(input.request.headers.get("content-type")?.startsWith("multipart/") ||
    input.path.startsWith("/storage/")
      ? { timeoutMs: 60_000 }
      : {}),
  });
}

function buildResponse(upstream: Response, requestId: string): NextResponse {
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "private, no-store");
  headers.append("Vary", "Cookie");
  headers.set(CONTEXT_HEADERS.requestId, requestId);
  headers.set(CONTEXT_HEADERS.correlationId, requestId);
  const hasBody = upstream.status !== 204 && upstream.status !== 304;
  return new NextResponse(hasBody ? upstream.body : null, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
