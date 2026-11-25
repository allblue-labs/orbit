import type { Instrumentation } from "next";
import { safeCorrelationId } from "@/lib/correlation-id";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const [sentry, { errorReporting }] = await Promise.all([
    import("@sentry/nextjs"),
    import("@/lib/error-reporting"),
  ]);
  sentry.init({
    ...errorReporting,
    dsn: process.env.SENTRY_DSN,
    release: process.env.ORBIT_COMMIT_SHA,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV,
  });
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return;
  const { captureException } = await import("@sentry/nextjs");
  captureException(error, {
    tags: {
      correlationId:
        safeCorrelationId(request.headers["x-correlation-id"]) ??
        safeCorrelationId(request.headers["x-request-id"]),
    },
  });
};
