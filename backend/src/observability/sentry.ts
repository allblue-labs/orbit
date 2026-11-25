let sdk: typeof import('@sentry/node') | undefined;
import { createHmac } from 'node:crypto';
import { processRole } from '../runtime/process-role';
import { safeCorrelationId } from './correlation';

const label = (value: unknown): string | undefined =>
  typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(value)
    ? value
    : undefined;

export async function configureErrorReporting(): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  const Sentry = await import('@sentry/node');
  sdk = Sentry;
  Sentry.init({
    dsn,
    release: process.env.ORBIT_COMMIT_SHA,
    environment: process.env.SENTRY_ENVIRONMENT?.trim() || process.env.NODE_ENV,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    tracesSampleRate: 0,
    defaultIntegrations: false,
    integrations: [
      Sentry.onUncaughtExceptionIntegration(),
      Sentry.onUnhandledRejectionIntegration(),
    ],
    beforeSend(event, hint) {
      hint.attachments = [];
      const organizationId = safeCorrelationId(event.tags?.organizationId);
      const key = process.env.SENTRY_TENANT_HASH_KEY;
      return {
        type: event.type,
        event_id: event.event_id,
        timestamp: event.timestamp,
        level: event.level,
        platform: event.platform,
        release: event.release,
        environment: event.environment,
        tags: {
          processRole: processRole(),
          correlationId: safeCorrelationId(event.tags?.correlationId),
          queue: label(event.tags?.queue),
          organizationId:
            key && organizationId
              ? createHmac('sha256', key)
                  .update(organizationId)
                  .digest('hex')
                  .slice(0, 24)
              : undefined,
        },
        exception: {
          values: event.exception?.values?.map((exception) => ({
            type: label(exception.type) ?? 'Error',
            stacktrace: {
              frames: exception.stacktrace?.frames
                ?.filter(
                  (frame) =>
                    !!frame.filename &&
                    /(?:^|\/)(?:dist\/src|src)\/[a-zA-Z0-9_./-]+\.[cm]?[jt]s$/.test(
                      frame.filename,
                    ),
                )
                .slice(-32)
                .map((frame) => ({
                  filename: frame.filename?.split(/\/(?:dist\/)?src\//).at(-1),
                  function: label(frame.function),
                  lineno: frame.lineno,
                  colno: frame.colno,
                })),
            },
          })),
        },
      };
    },
  });
}

export function captureOrbitError(
  error: unknown,
  context?: { requestId: string; organizationId: string | null },
  queue?: string,
): void {
  if (!sdk?.isInitialized()) return;
  sdk.captureException(error, {
    tags: {
      correlationId: context?.requestId,
      organizationId: context?.organizationId ?? undefined,
      queue,
    },
  });
}
