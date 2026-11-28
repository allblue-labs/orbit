import { safeCorrelationId } from "@/lib/correlation-id";

export function logProxy(
  request: Request,
  route: "orbit" | "portal" | "auth",
  correlationId: string,
  durationMs: number,
  status: number,
  identity?: { userId: string; organizationId: string | null },
): void {
  console.info(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: status >= 500 ? "error" : "info",
      processRole: "web",
      event: "http_proxy",
      correlationId: safeCorrelationId(correlationId) ?? null,
      organizationId: safeCorrelationId(identity?.organizationId) ?? null,
      userId: safeCorrelationId(identity?.userId) ?? null,
      durationMs: Math.round(durationMs * 100) / 100,
      route,
      method: request.method,
      status,
    }),
  );
}
