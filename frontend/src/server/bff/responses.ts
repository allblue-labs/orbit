/**
 * Respostas do BFF.
 *
 * Erros gerados no próprio BFF usam exatamente o mesmo envelope do backend,
 * para que o cliente tenha um único formato a interpretar.
 */
import { NextResponse } from "next/server";

import { CONTEXT_HEADERS } from "@/lib/context-headers";
import { serverEnv } from "@/lib/env";
import type { ApiErrorEnvelope } from "@/types/api";

export interface BffErrorInit {
  status: number;
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}

export function bffError(init: BffErrorInit): NextResponse<ApiErrorEnvelope> {
  const body: ApiErrorEnvelope = {
    success: false,
    error: {
      code: init.code,
      message: init.message,
      status: init.status,
      details: init.details,
    },
    requestId: init.requestId,
    timestamp: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    status: init.status,
    headers: { [CONTEXT_HEADERS.requestId]: init.requestId },
  });
}

export function bffJson<T>(
  data: T,
  requestId: string,
  status = 200,
): NextResponse {
  return NextResponse.json(
    { success: true, data, requestId, timestamp: new Date().toISOString() },
    { status, headers: { [CONTEXT_HEADERS.requestId]: requestId } },
  );
}

/**
 * Requisições devem partir de uma das origens exatas da aplicação.
 * `same-site` não é suficiente: um subdomínio comprometido também é
 * same-site, mas não deve conseguir usar cookies HttpOnly do BFF como
 * autoridade.
 *
 * A comparação é de **igualdade exata** contra a lista configurada — não há
 * prefixo, sufixo nem curinga. Uma implantação serve mais de uma origem
 * legítima (`localhost` no smoke local, o domínio público em produção), e
 * `localhost` e `127.0.0.1` são origens **diferentes** para o navegador:
 * configurar uma e navegar pela outra é recusa, não engano.
 */
export function isSameOriginRequest(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const configured = serverEnv.frontendOrigins;
  const permitidas =
    configured.length > 0 ? configured : [new URL(request.url).origin];
  const safeMethod = request.method === "GET" || request.method === "HEAD";
  const conhecida = origin !== null && permitidas.includes(origin);

  if (origin && !conhecida) return false;
  if (safeMethod) return site === "same-origin" || site === "none";
  return site === "same-origin" && conhecida;
}
