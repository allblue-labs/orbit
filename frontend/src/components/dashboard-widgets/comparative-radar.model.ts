import type { AnalyticsKpi } from "@/types/dashboard";

export const RADAR_AXES = [
  ["operations.sla_compliance", "Prazo", "Concluídos no prazo"],
  ["operations.scheduling_coverage", "Agenda", "Demandas com agenda"],
  ["technicians.assignment_coverage", "Equipe", "Demandas com técnico"],
  ["pmoc.compliance", "PMOC", "PMOC em dia"],
  ["rvt.compliance", "RVT", "RVT em dia"],
] as const;
export interface RadarRow {
  axis: string;
  label: string;
  current: number | null;
  previous: number | null;
}

/** An absent denominator is unknown, not zero performance. */
export function comparativeAxes(
  current: readonly AnalyticsKpi[],
  previous: readonly AnalyticsKpi[],
): RadarRow[] {
  const value = (items: readonly AnalyticsKpi[], id: string) => {
    const item = items.find((metric) => metric.id === id);
    return item && item.unit === "%" && item.sampleSize !== 0
      ? item.value
      : null;
  };
  const rows = RADAR_AXES.map(([id, axis, label]) => ({
    axis,
    label,
    current: value(current, id),
    previous: value(previous, id),
  })).filter((row) => row.current !== null || row.previous !== null);
  const shared = rows.filter(
    (row) => row.current !== null && row.previous !== null,
  );
  if (shared.length >= 3) return shared;
  const measuredCurrent = rows.filter((row) => row.current !== null);
  if (measuredCurrent.length >= 3) return measuredCurrent;
  const measuredPrevious = rows.filter((row) => row.previous !== null);
  return measuredPrevious.length >= 3 ? measuredPrevious : rows;
}
