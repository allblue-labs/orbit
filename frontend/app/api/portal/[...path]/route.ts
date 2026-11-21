import type { NextRequest } from "next/server";

import {
  proxyToPortal,
  type PortalRouteContext,
} from "@/server/portal/portal-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const handler = (
  request: NextRequest,
  context: PortalRouteContext,
): Promise<Response> => proxyToPortal(request, context);

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
