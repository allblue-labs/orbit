import { addZonedDays, instantFromZoned } from "@/lib/scheduling";

/** Includes today: seven selected days start six civil days before today. */
export function recentPeriodStart(
  day: string,
  days: number,
  timeZone: string,
): string {
  const start = instantFromZoned(
    {
      year: Number(day.slice(0, 4)),
      month: Number(day.slice(5, 7)),
      day: Number(day.slice(8, 10)),
    },
    timeZone,
  );
  return addZonedDays(start, 1 - days, timeZone).toISOString();
}
