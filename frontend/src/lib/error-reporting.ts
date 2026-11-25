import type { BrowserOptions } from "@sentry/nextjs";
import { safeCorrelationId } from "./correlation-id";

export const errorReporting: Pick<
  BrowserOptions,
  "tracesSampleRate" | "beforeSend" | "defaultIntegrations" | "dataCollection"
> = {
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  },
  tracesSampleRate: 0,
  defaultIntegrations: false,
  beforeSend(event, hint) {
    hint.attachments = [];
    return {
      type: event.type,
      event_id: event.event_id,
      timestamp: event.timestamp,
      level: event.level,
      release: event.release,
      environment: event.environment,
      platform: event.platform,
      tags: {
        processRole: "web",
        correlationId: safeCorrelationId(event.tags?.correlationId),
      },
      exception: {
        values: event.exception?.values?.map((value) => ({
          type:
            value.type && /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(value.type)
              ? value.type
              : "Error",
          stacktrace: {
            frames: value.stacktrace?.frames
              ?.flatMap((frame) => {
                const filename = frame.filename?.match(
                  /(?:^|\/)((?:app|src|static\/chunks)\/[a-zA-Z0-9_./-]+\.[cm]?[jt]sx?)$/,
                )?.[1];
                return filename
                  ? [{ filename, lineno: frame.lineno, colno: frame.colno }]
                  : [];
              })
              .slice(-32),
          },
        })),
      },
    };
  },
};
