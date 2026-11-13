/**
 * Rotação do par de tokens.
 *
 * Isolado de `session.ts` porque o Proxy do Next precisa renovar
 * a sessão sem importar `next/headers`, indisponível naquele contexto.
 */
import { backendJson, jsonBody } from "@/server/backend-client";
import { ApiError } from "@/lib/api-error";
import type { TokenPair } from "@/types/session";

/** Only deduplicate requests still in flight. The database owns grace/revocation
 * across BFF replicas and mobile; completed responses must not mask logout. */
const inFlight = new Map<string, Promise<TokenPair | null>>();

/**
 * Renova o par de tokens; `null` quando o refresh token não é mais válido.
 *
 * Chamadas concorrentes com o mesmo token compartilham a mesma promessa, e as
 * demais consultam novamente a API, inclusive após revogação.
 */
export function refreshTokens(refreshToken: string): Promise<TokenPair | null> {
  const pending = inFlight.get(refreshToken);
  if (pending) return pending;

  const request = backendJson<TokenPair>({
    method: "POST",
    path: "/identity/refresh",
    body: jsonBody({ refreshToken }),
    retries: 0,
  })
    .catch((error: unknown) => {
      if (error instanceof ApiError && [401, 403].includes(error.status))
        return null;
      throw error;
    })
    .finally(() => {
      inFlight.delete(refreshToken);
    });

  inFlight.set(refreshToken, request);
  return request;
}
