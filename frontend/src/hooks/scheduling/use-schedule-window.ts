"use client";

import { useState } from "react";

/** Keep the query's time window fixed while the detail page is mounted.
 * Recreating "now" on render produces a new query key after every response.
 */
export function useScheduleWindow(horizonDays: number) {
  const [from] = useState(() => new Date().toISOString());
  const to = new Date(from);
  to.setDate(to.getDate() + horizonDays);
  return { from, to: to.toISOString() };
}
