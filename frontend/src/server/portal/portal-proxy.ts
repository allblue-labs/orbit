/**
 * O proxy do cliente: `/api/portal/<caminho>` → `/api/v1/portal/<caminho>`.
 *
 * Mesmo desenho do proxy da equipe — origem conferida, corpo limitado,
 * renovação uma vez em 401 —, com três diferenças deliberadas: cookies
 * próprios, só caminhos `/portal/...`, e nenhum cabeçalho de organização ou
 * unidade: o escopo do cliente vem do token, e o servidor ignora o resto.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { toApiError } from "@/lib/api-error";
import { CONTEXT_HEADERS } from "@/lib/context-headers";
import { backendFetch } from "@/server/backend-client";
import { readBffBody, BffBodyError } from "@/server/bff/request-body";
import { bffError, isSameOriginRequest } from "@/server/bff/responses";
import { readContextFromRequest } from "@/server/request-context";
import { withClientOrigin } from "@/server/trusted-client-origin";
import type { HttpMethod } from "@/types/api";
import { buildSafePath } from "@/utils/http";
import {
  endPortalSession,
  persistPortalSession,
  PORTAL_ACCESS_COOKIE,
  PORTAL_REFRESH_COOKIE,
  portalPathAllowed,
  portalRefresh,
  portalTokenExpired,
  type PortalTokens,
} from "./portal-session";

const REQUEST_HEADERS = ["accept", "content-type", "idempotency-key"];
const RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "vary",
  "etag",
  "x-request-id",
  "retry-after",
];

export interface PortalRouteContext {
  params: Promise<{ path?: string[] }>;
}

export function proxyToPortal(
  request: NextRequest,
  context: PortalRouteContext,
): Promise<Response> {
  return withClientOrigin(request, async () => {
    const { requestId, locale, timezone } = readContextFromRequest(request);
    if (!isSameOriginRequest(request)) {
      return bffError({
        status: 403,
        code: "FORBIDDEN_ORIGIN",
        message: "Origem da solicitação não permitida.",
        requestId,
      });
    }
    const { path: segments = [] } = await context.params;
    const resto = buildSafePath(segments);
    const method = request.method.toUpperCase() as HttpMethod;
    const path = resto ? `/portal${resto}` : null;
    if (!path || !portalPathAllowed(path, method)) {
      return bffError({
        status: 404,
        code: "NOT_FOUND",
        message: "Recurso não encontrado.",
        requestId,
      });
    }

    let accessToken = request.cookies.get(PORTAL_ACCESS_COOKIE)?.value;
    const refreshToken = request.cookies.get(PORTAL_REFRESH_COOKIE)?.value;
    let rotated: PortalTokens | null = null;
    if (portalTokenExpired(accessToken)) {
      rotated = await portalRefresh(refreshToken);
      accessToken = rotated?.accessToken;
    }
    if (!accessToken) {
      const response = bffError({
        status: 401,
        code: "SESSION_EXPIRED",
        message: "Sua sessão expirou. Entre novamente.",
        requestId,
      });
      endPortalSession(response.cookies);
      return response;
    }

    let retained: { body: ArrayBuffer | null; release: () => void } = {
      body: null,
      release: () => undefined,
    };
    try {
      if (["POST", "PUT", "PATCH"].includes(method))
        retained = await readBffBody(request);
      const enviar = (token: string) => {
        const headers: Record<string, string> = {};
        for (const nome of REQUEST_HEADERS) {
          const valor = request.headers.get(nome);
          if (valor) headers[nome] = valor;
        }
        return backendFetch({
          method,
          path,
          search: request.nextUrl.search,
          headers,
          body: retained.body,
          accessToken: token,
          requestId,
          locale,
          timezone,
          retries: 0,
          signal: request.signal,
          ...(request.headers.get("content-type")?.startsWith("multipart/")
            ? { timeoutMs: 60_000 }
            : {}),
        });
      };
      let upstream = await enviar(accessToken);
      if (upstream.status === 401 && !rotated) {
        await upstream.body?.cancel();
        rotated = await portalRefresh(refreshToken);
        if (!rotated) {
          const response = bffError({
            status: 401,
            code: "SESSION_EXPIRED",
            message: "Sua sessão expirou. Entre novamente.",
            requestId,
          });
          endPortalSession(response.cookies);
          return response;
        }
        upstream = await enviar(rotated.accessToken);
      }
      const headers = new Headers();
      for (const nome of RESPONSE_HEADERS) {
        const valor = upstream.headers.get(nome);
        if (valor) headers.set(nome, valor);
      }
      headers.set("Cache-Control", "private, no-store");
      headers.append("Vary", "Cookie");
      headers.set(CONTEXT_HEADERS.requestId, requestId);
      const corpo = upstream.status !== 204 && upstream.status !== 304;
      const response = new NextResponse(corpo ? upstream.body : null, {
        status: upstream.status,
        headers,
      });
      if (rotated) persistPortalSession(response.cookies, rotated);
      return response;
    } catch (error) {
      const apiError = toApiError(error);
      const response = bffError({
        status:
          error instanceof BffBodyError
            ? error.status
            : apiError.kind === "timeout"
              ? 504
              : 502,
        code: apiError.code,
        message: apiError.message,
        requestId,
      });
      if (rotated) persistPortalSession(response.cookies, rotated);
      return response;
    } finally {
      retained.release();
    }
  });
}
