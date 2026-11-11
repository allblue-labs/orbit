import { describe, expect, it } from "vitest";
import type { AnalyticsKpi } from "@/types/dashboard";
import { presentMetric } from "@/metrics";
import { comparativeAxes } from "./comparative-radar.model";
const metric = (id: string, value: number, sampleSize = 1): AnalyticsKpi => ({
  id,
  value,
  sampleSize,
  domain: "OPERATIONS",
  unit: "%",
  label: id,
  status: "HEALTHY",
  direction: "STABLE",
  changePercent: 0,
  source: "operations",
  dataQuality: "DERIVED",
});
describe("dashboard measured indicators", () => {
  it("keeps a real zero and an absent denominator distinct", () => {
    const rows = comparativeAxes(
      [metric("operations.sla_compliance", 0, 2)],
      [metric("operations.sla_compliance", 0, 0)],
    );
    expect(rows).toEqual([
      {
        axis: "Prazo",
        label: "Concluídos no prazo",
        current: 0,
        previous: null,
      },
    ]);
  });
  it("does not create a previous series when no previous metric exists", () => {
    expect(
      comparativeAxes([metric("pmoc.compliance", 100)], [])[0].previous,
    ).toBeNull();
  });
  it("excludes unknown axes, counts and unmeasured rates", () => {
    expect(
      comparativeAxes(
        [
          metric("equipment.availability", 100),
          { ...metric("operations.total", 5), unit: undefined },
          metric("rvt.compliance", 0, 0),
        ],
        [],
      ),
    ).toEqual([]);
  });
  it("uses all five short operational axes without resizing the component", () => {
    expect(
      comparativeAxes(
        [
          "operations.sla_compliance",
          "operations.scheduling_coverage",
          "technicians.assignment_coverage",
          "pmoc.compliance",
          "rvt.compliance",
        ].map((id) => metric(id, 80)),
        [],
      ).map((row) => row.axis),
    ).toEqual(["Prazo", "Agenda", "Equipe", "PMOC", "RVT"]);
  });
  it("selects shared axes before drawing a comparison with missing samples", () => {
    const ids = [
      "operations.sla_compliance",
      "operations.scheduling_coverage",
      "technicians.assignment_coverage",
      "pmoc.compliance",
      "rvt.compliance",
    ];
    const rows = comparativeAxes(
      ids.map((id) => metric(id, 80)),
      ids.slice(1).map((id) => metric(id, 70)),
    );
    expect(rows).toHaveLength(4);
    expect(
      rows.every((row) => row.current !== null && row.previous !== null),
    ).toBe(true);
  });
  it("uses the measured current axes when there is no complete comparison", () => {
    const current = [
      "operations.sla_compliance",
      "operations.scheduling_coverage",
      "technicians.assignment_coverage",
    ].map((id) => metric(id, 80));
    const rows = comparativeAxes(current, [metric("pmoc.compliance", 100)]);
    expect(rows).toHaveLength(3);
    expect(
      rows.every((row) => row.current !== null && row.previous === null),
    ).toBe(true);
  });
  it("displays missing samples as unknown and hides fabricated growth", () => {
    const result = presentMetric({
      ...metric("operations.sla_compliance", 0, 0),
      comparisonAvailable: false,
      changePercent: 100,
    });
    expect(result.value).toBe("—");
    expect(result.statusLabel).toBe("Sem base de cálculo");
    expect(result.change).toBeUndefined();
  });
  it("shows percentage points rather than relative growth for rate comparisons", () => {
    expect(
      presentMetric({
        ...metric("operations.sla_compliance", 90),
        changeUnit: "POINTS",
        changePercent: 10,
        comparisonAvailable: true,
      }).change,
    ).toBe("+10 p.p.");
    expect(
      presentMetric({
        ...metric("operations.completed", 0, 0),
        unit: undefined,
      }).value,
    ).toBe("0");
  });
});
