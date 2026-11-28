import { backendJson } from "@/server/backend-client";
import { bffError, bffJson } from "@/server/bff/responses";
import { createRouteHandler } from "@/server/bff/route-handler";
import {
  endPortalSession,
  persistPortalSession,
  PORTAL_ACCESS_COOKIE,
  PORTAL_REFRESH_COOKIE,
  portalRefresh,
  portalTokenExpired,
} from "@/server/portal/portal-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Quem está logado como cliente — renovando, se preciso. 401 quando não há
 * sessão: a área do cliente manda para o login.
 */
export const GET = createRouteHandler(async ({ request, requestId }) => {
  let accessToken = request.cookies.get(PORTAL_ACCESS_COOKIE)?.value;
  const rotated = portalTokenExpired(accessToken)
    ? await portalRefresh(request.cookies.get(PORTAL_REFRESH_COOKIE)?.value)
    : null;
  if (rotated) accessToken = rotated.accessToken;
  if (portalTokenExpired(accessToken) && !rotated) {
    const response = bffError({
      status: 401,
      code: "SESSION_EXPIRED",
      message: "Entre para continuar.",
      requestId,
    });
    endPortalSession(response.cookies);
    return response;
  }
  const me = await backendJson<unknown>({
    path: "/portal/me",
    accessToken,
    retries: 0,
  });
  const response = bffJson({ me }, requestId);
  if (rotated) persistPortalSession(response.cookies, rotated);
  return response;
});
