"use client";

import { useMemo } from "react";
import { createDateFormatters } from "@/lib/formatters";
import { useTimeZone } from "./use-timezone";

/** Re-renders date labels as soon as the confirmed preference changes. */
export function useDateFormatters() {
  const { timeZone } = useTimeZone();
  return useMemo(() => createDateFormatters(timeZone), [timeZone]);
}
