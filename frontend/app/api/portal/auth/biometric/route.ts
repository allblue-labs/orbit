import { bffJson } from "@/server/bff/responses";
import { createRouteHandler } from "@/server/bff/route-handler";
import { biometricLogin } from "@/server/biometrics/biometric-login";
import { persistPortalSession } from "@/server/portal/portal-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** O cliente entra com a passkey: tokens em cookies HttpOnly próprios. */
export const POST = createRouteHandler(async ({ json, request, requestId }) => {
  const session = await biometricLogin(
    "portal",
    await json<{ challengeId?: unknown; response?: unknown }>(),
    request.headers.get("user-agent"),
  );
  const response = bffJson({ me: session.me }, requestId);
  persistPortalSession(response.cookies, session);
  return response;
});
