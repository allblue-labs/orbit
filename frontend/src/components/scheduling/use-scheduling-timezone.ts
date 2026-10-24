"use client";

/** Scheduling follows the same personal timezone preference as the rest of Orbit. */
export { useTimeZone as useSchedulingTimeZone } from "@/hooks/use-timezone";
export type { ResolvedTimeZone as SchedulingTimeZone } from "@/lib/timezone-preference";
