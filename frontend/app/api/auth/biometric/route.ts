import { persistSession } from "@/server/auth/session";
import { bffJson } from "@/server/bff/responses";
import { createRouteHandler } from "@/server/bff/route-handler";
import { biometricLogin } from "@/server/biometrics/biometric-login";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Entra com a passkey: os tokens vão para cookies HttpOnly. */
export const POST = createRouteHandler(async ({ json, request, requestId }) => {
  const tokens = await biometricLogin(
    "team",
    await json<{ challengeId?: unknown; response?: unknown }>(),
    request.headers.get("user-agent"),
  );
  const response = bffJson({ authenticated: true }, requestId);
  persistSession(response.cookies, tokens);
  return response;
});
