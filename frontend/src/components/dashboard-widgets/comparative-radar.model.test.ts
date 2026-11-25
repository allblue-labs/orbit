import { describe, expect, it } from "vitest";

import type { AnalyticsKpi } from "@/types/dashboard";
import {
  radarDeltaText,
  radarRows,
  radarShape,
  radarSummary,
} from "./comparative-radar.model";

const rate = (id: string, numerator: number, denominator: number): AnalyticsKpi =>
  ({
    id,
    label: id,
    domain: "OPERATIONS",
    value: denominator ? Math.round((numerator / denominator) * 100) : 0,
    unit: "%",
    sampleSize: denominator,
    basis: { numerator, denominator },
    status: "HEALTHY",
    direction: "STABLE",
    changePercent: 0,
    source: "operations",
    dataQuality: "DERIVED",
  }) as AnalyticsKpi;

describe("radar comparativo", () => {
  it("compara em pontos e diz se melhorou", () => {
    const rows = radarRows(
      [rate("operations.sla_compliance", 9, 10), rate("pmoc.compliance", 3, 4)],
      [rate("operations.sla_compliance", 8, 10), rate("pmoc.compliance", 4, 4)],
    );
    expect(rows.map((row) => [row.axis, row.current, row.delta, row.trend])).toEqual([
      ["No prazo", 90, 10, "better"],
      ["PMOC", 75, -25, "worse"],
    ]);
    expect(rows[0].currentBasis).toBe("9 de 10");
    expect(radarDeltaText(rows[0])).toBe("+10 pts");
    expect(radarDeltaText(rows[1])).toBe("−25 pts");
    expect(radarSummary(rows)).toBe("Melhorou em 1 e piorou em 1 de 2 indicadores.");
  });

  it("sem base não é zero, e não entra no desenho", () => {
    const rows = radarRows(
      [rate("operations.sla_compliance", 0, 2), rate("rvt.compliance", 0, 0)],
      [rate("operations.sla_compliance", 0, 0)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ current: 0, previous: null, delta: null, trend: "none" });
    expect(radarDeltaText(rows[0])).toBe("sem anterior");
    expect(radarSummary(rows)).toBeNull();
    expect(radarShape(rows).axes).toEqual([]);
  });

  it("desenha o mês anterior só quando ele tem todos os eixos", () => {
    const now = [
      rate("operations.sla_compliance", 1, 1),
      rate("operations.completion_rate", 1, 2),
      rate("technicians.assignment_coverage", 2, 2),
    ];
    const parcial = radarShape(radarRows(now, [rate("operations.sla_compliance", 1, 1)]));
    expect(parcial.axes).toHaveLength(3);
    expect(parcial.drawPrevious).toBe(false);
    const completo = radarShape(radarRows(now, now));
    expect(completo.drawPrevious).toBe(true);
    expect(radarSummary(radarRows(now, now))).toBe("Estável nos 3 indicadores comparáveis.");
  });
});
