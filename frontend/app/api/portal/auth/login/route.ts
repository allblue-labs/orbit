import { bffJson } from "@/server/bff/responses";
import { createRouteHandler } from "@/server/bff/route-handler";
import {
  persistPortalSession,
  portalLogin,
} from "@/server/portal/portal-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Entra como cliente: os tokens vão para cookies HttpOnly, nunca para a página. */
export const POST = createRouteHandler(async ({ json, request, requestId }) => {
  const session = await portalLogin(
    await json<{ email: string; password: string }>(),
    request.headers.get("user-agent"),
  );
  const response = bffJson({ me: session.me }, requestId);
  persistPortalSession(response.cookies, session);
  return response;
});
