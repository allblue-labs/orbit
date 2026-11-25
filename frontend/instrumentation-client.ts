import * as Sentry from "@sentry/nextjs";
import { errorReporting } from "@/lib/error-reporting";

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    ...errorReporting,
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
    integrations: [Sentry.globalHandlersIntegration()],
  });
}
