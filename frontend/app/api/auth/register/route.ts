import { endSession, register } from "@/server/auth/session";
import { bffJson } from "@/server/bff/responses";
import { createRouteHandler } from "@/server/bff/route-handler";
import type { RegisterInput } from "@/types/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = createRouteHandler(async ({ json, requestId }) => {
  const pending = await register(await json<RegisterInput>());
  if (
    pending.status !== "EMAIL_VERIFICATION_REQUIRED" ||
    typeof pending.email !== "string"
  )
    throw new Error("Invalid registration response");
  const response = bffJson(
    { authenticated: false, status: pending.status, email: pending.email },
    requestId,
    201,
  );
  endSession(response.cookies);
  return response;
});
