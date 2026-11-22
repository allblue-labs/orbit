import { describe, expect, it } from "vitest";

import type { AnalyticsKpi } from "@/types/dashboard";
import { operationHealth, toneFor } from "./operation-health.model";

const rate = (id: string, numerator: number, denominator: number) =>
  ({
    id,
    value: 0,
    unit: "%",
    domain: "OPERATIONS",
    label: id,
    status: "HEALTHY",
    direction: "STABLE",
    changePercent: 0,
    source: "operations",
    dataQuality: "DERIVED",
    sampleSize: denominator,
    basis: { numerator, denominator },
  }) as AnalyticsKpi;

describe("saúde da operação", () => {
  it("cada barra diz a proporção e o problema em palavra", () => {
    const { bars, attention, withoutData } = operationHealth([
      rate("operations.backlog_punctuality", 9, 12),
      rate("technicians.backlog_coverage", 12, 12),
      rate("pmoc.compliance", 1, 2),
    ]);
    expect(bars.map((bar) => [bar.id, bar.percent, bar.tone, bar.gap])).toEqual([
      ["operations.backlog_punctuality", 75, "attention", "3 atrasados"],
      ["technicians.backlog_coverage", 100, "ok", null],
      ["pmoc.compliance", 50, "critical", "1 vencido"],
    ]);
    expect(attention).toBe(2);
    expect(withoutData).toEqual([
      "Em aberto com data marcada",
      "Concluídos dentro do prazo",
      "Visitas de RVT em dia",
    ]);
  });

  it("sem base de cálculo não vira barra de zero", () => {
    const { bars, withoutData } = operationHealth([rate("rvt.compliance", 0, 0)]);
    expect(bars).toEqual([]);
    expect(withoutData).toContain("Visitas de RVT em dia");
  });

  it("faixas: 90 em diante ok, 70 a 89 atenção, abaixo crítico", () => {
    expect([toneFor(90), toneFor(89), toneFor(70), toneFor(69)]).toEqual([
      "ok",
      "attention",
      "attention",
      "critical",
    ]);
  });
});
