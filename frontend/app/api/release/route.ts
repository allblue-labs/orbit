import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Identifica o código servido, sem publicar configuração ou credenciais. */
export function GET() {
  return NextResponse.json(
    {
      service: "orbit-frontend",
      billingFlow: "checkout-required-v2",
      commit: process.env.ORBIT_COMMIT_SHA ?? "unknown",
      builtAt: process.env.ORBIT_BUILD_TIME ?? "unknown",
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
