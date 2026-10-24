"use client";

import { DEFAULT_TIMEZONE } from "@/lib/env";
import { useOptionalRequestContext } from "@/providers/request-context-provider";

/** The same effective zone used by HTTP context, scheduling and date labels. */
export function useTimeZone() {
  const context = useOptionalRequestContext();
  return {
    timeZone: context?.timezone ?? DEFAULT_TIMEZONE,
    origin: context?.timezoneOrigin ?? "padrão da aplicação",
  };
}
