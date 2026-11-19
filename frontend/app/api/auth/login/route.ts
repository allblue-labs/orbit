import { login, persistSession } from "@/server/auth/session";
import { bffJson } from "@/server/bff/responses";
import { createRouteHandler } from "@/server/bff/route-handler";
import type { LoginInput } from "@/types/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createRouteHandler(async ({ json, request, requestId }) => {
  const tokens = await login(
    await json<LoginInput>(),
    request.headers.get("user-agent"),
  );
  const response = bffJson({ authenticated: true }, requestId);
  persistSession(response.cookies, tokens);
  return response;
});
