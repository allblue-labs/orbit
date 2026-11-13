/**
 * Fábrica dos Route Handlers do BFF que não passam pelo proxy genérico
 * (autenticação e sessão).
 *
 * Centraliza verificação de origem, contexto de requisição e tradução de
 * erros para o envelope padrão — os handlers só descrevem a regra.
 */
import type { NextRequest, NextResponse } from "next/server";

import { ApiError, toApiError } from "@/lib/api-error";
import { withClientOrigin } from "@/server/trusted-client-origin";
import { readContextFromRequest } from "@/server/request-context";
import { bffError, isSameOriginRequest } from "./responses";

export interface RouteContext {
  request: NextRequest;
  requestId: string;
  /** Corpo JSON tipado. Erros de parsing viram 400 automaticamente. */
  json: <T>() => Promise<T>;
}

export type RouteImplementation = (
  context: RouteContext,
) => Promise<NextResponse>;

export function createRouteHandler(
  implementation: RouteImplementation,
): (request: NextRequest) => Promise<Response> {
  return (request: NextRequest): Promise<Response> =>
    withClientOrigin(request, async () => {
      const { requestId } = readContextFromRequest(request);
      if (!isSameOriginRequest(request)) {
        return bffError({
          status: 403,
          code: "FORBIDDEN_ORIGIN",
          message: "Origem da solicitação não permitida.",
          requestId,
        });
      }
      try {
        return await implementation({
          request,
          requestId,
          json: async <T>(): Promise<T> => {
            try {
              return (await request.json()) as T;
            } catch (error) {
              throw new ApiError({
                kind: "parse",
                status: 400,
                code: "INVALID_BODY",
                message: "Corpo da requisição inválido.",
                cause: error,
              });
            }
          },
        });
      } catch (error) {
        const apiError = toApiError(error);
        return bffError({
          status: apiError.status >= 400 ? apiError.status : 502,
          code: apiError.code,
          message: apiError.message,
          details: apiError.details,
          requestId,
        });
      }
    });
}
