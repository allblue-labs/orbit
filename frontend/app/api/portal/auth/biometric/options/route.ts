import { bffJson } from "@/server/bff/responses";
import { createRouteHandler } from "@/server/bff/route-handler";
import { biometricChallenge } from "@/server/biometrics/biometric-login";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Desafio de uso único para a passkey do cliente assinar. */
export const POST = createRouteHandler(async ({ requestId }) =>
  bffJson(await biometricChallenge("portal"), requestId),
);
