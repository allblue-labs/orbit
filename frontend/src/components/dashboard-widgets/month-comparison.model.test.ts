import { describe, expect, it } from "vitest";

import type { AnalyticsKpi } from "@/types/dashboard";
import { comparisonRows, deltaText } from "./month-comparison.model";

const kpi = (id: string, value: number, extra: Partial<AnalyticsKpi> = {}): AnalyticsKpi =>
  ({
    id,
    value,
    domain: "OPERATIONS",
    label: id,
    status: "HEALTHY",
    direction: "STABLE",
    changePercent: 0,
    source: "operations",
    dataQuality: "OBSERVED",
    ...extra,
  }) as AnalyticsKpi;

const rate = (id: string, numerator: number, denominator: number) =>
  kpi(id, denominator ? Math.round((numerator / denominator) * 100) : 0, {
    unit: "%",
    sampleSize: denominator,
    basis: { numerator, denominator },
  });

describe("este mês × mês anterior", () => {
  it("contagem em %, percentual em pontos, com a direção certa", () => {
    const rows = comparisonRows(
      [kpi("operations.completed", 12), rate("operations.sla_compliance", 9, 12)],
      [kpi("operations.completed", 10), rate("operations.sla_compliance", 9, 10)],
    );
    const concluidos = rows.find((row) => row.id === "operations.completed")!;
    expect(concluidos).toMatchObject({ current: 12, previous: 10, delta: 20, trend: "better" });
    expect(deltaText(concluidos)).toBe("+20%");
    const prazo = rows.find((row) => row.id === "operations.sla_compliance")!;
    expect(prazo).toMatchObject({ current: 75, previous: 90, delta: -15, trend: "worse", currentBasis: "9 de 12" });
    expect(deltaText(prazo)).toBe("−15 pts");
  });

  it("volume de demandas não é bom nem ruim por si", () => {
    const [row] = comparisonRows([kpi("operations.total", 30)], [kpi("operations.total", 20)]);
    expect(row).toMatchObject({ trend: "neutral", delta: 50 });
  });

  it("percentual sem base é sem dados, e some quando os dois meses estão vazios", () => {
    const rows = comparisonRows(
      [rate("pmoc.compliance", 0, 0), rate("rvt.compliance", 4, 5)],
      [rate("pmoc.compliance", 0, 0), rate("rvt.compliance", 0, 0)],
    );
    expect(rows.map((row) => row.id)).toEqual(["rvt.compliance"]);
    expect(rows[0]).toMatchObject({ current: 80, previous: null, trend: "none" });
    expect(deltaText(rows[0]!)).toBe("sem base anterior");
  });

  it("de zero para algo é novo, de zero para zero é igual", () => {
    const [novo] = comparisonRows([kpi("operations.completed", 3)], [kpi("operations.completed", 0)]);
    expect(deltaText(novo!)).toBe("novo");
    const [igual] = comparisonRows([kpi("operations.completed", 0)], [kpi("operations.completed", 0)]);
    expect(deltaText(igual!)).toBe("igual");
  });
});
