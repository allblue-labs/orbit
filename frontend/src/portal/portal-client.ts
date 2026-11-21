/**
 * O cliente HTTP da área do cliente na web.
 *
 * Fala só com `/api/portal/*` — o BFF do cliente, com cookies próprios. Não
 * usa o `apiClient` da equipe de propósito: ele carrega escopo de organização
 * e unidade e renova a sessão da equipe, e nada disso pertence ao cliente.
 */
import { ApiError, parseErrorEnvelope } from "@/lib/api-error";

export class PortalSessionExpired extends ApiError {}

async function ler(response: Response): Promise<unknown> {
  const texto = await response.text();
  if (!texto) return null;
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    return texto;
  }
}

export async function portalRequest<T>(
  path: string,
  init: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    query?: Record<string, string | number | undefined | null>;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [chave, valor] of Object.entries(init.query ?? {}))
    if (valor !== undefined && valor !== null && valor !== "")
      params.set(chave, String(valor));
  const url = `/api/portal${path}${params.size ? `?${params}` : ""}`;
  const multipart = init.body instanceof FormData;
  const response = await fetch(url, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...(init.body !== undefined && !multipart
        ? { "content-type": "application/json" }
        : {}),
      ...init.headers,
    },
    body:
      init.body === undefined
        ? undefined
        : multipart
          ? (init.body as FormData)
          : JSON.stringify(init.body),
  });
  const payload = await ler(response);
  if (!response.ok) {
    const erro = parseErrorEnvelope(payload);
    const Classe = response.status === 401 ? PortalSessionExpired : ApiError;
    throw new Classe({
      kind: "http",
      status: response.status,
      code: erro.code,
      message: erro.message,
      requestId: erro.requestId,
      details: erro.details,
    });
  }
  if (payload && typeof payload === "object" && "data" in payload)
    return (payload as { data: T }).data;
  return payload as T;
}
