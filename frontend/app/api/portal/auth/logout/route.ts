import { bffJson } from "@/server/bff/responses";
import { createRouteHandler } from "@/server/bff/route-handler";
import {
  endPortalSession,
  PORTAL_ACCESS_COOKIE,
  portalLogout,
} from "@/server/portal/portal-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createRouteHandler(async ({ request, requestId }) => {
  await portalLogout(request.cookies.get(PORTAL_ACCESS_COOKIE)?.value);
  const response = bffJson({ authenticated: false }, requestId);
  endPortalSession(response.cookies);
  return response;
});
