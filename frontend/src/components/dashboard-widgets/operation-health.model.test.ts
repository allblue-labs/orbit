import { describe, expect, it } from "vitest";

import type { AnalyticsKpi } from "@/types/dashboard";
import {
  barsOf,
  monthVolume,
  operationHealth,
  toneFor,
  volumeDeltaText,
} from "./operation-health.model";

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

  it("separa a fila em aberto dos prazos e contratos", () => {
    const { bars } = operationHealth([
      rate("operations.backlog_punctuality", 9, 12),
      rate("operations.sla_compliance", 4, 5),
      rate("rvt.compliance", 2, 2),
    ]);
    expect(barsOf(bars, "queue").map((bar) => bar.id)).toEqual([
      "operations.backlog_punctuality",
    ]);
    expect(barsOf(bars, "contracts").map((bar) => bar.id)).toEqual([
      "operations.sla_compliance",
      "rvt.compliance",
    ]);
  });

  it("volume do mês: contagens dos dois meses e a variação em %", () => {
    const count = (id: string, value: number) =>
      ({ ...rate(id, 0, 0), unit: undefined, basis: undefined, value }) as AnalyticsKpi;
    const rows = monthVolume(
      [count("operations.total", 12), count("operations.completed", 3)],
      [count("operations.total", 10), count("operations.completed", 0)],
    );
    expect(rows.map((row) => [row.label, row.current, row.previous, volumeDeltaText(row)])).toEqual([
      ["Demandas abertas", 12, 10, "+20%"],
      ["Atendimentos concluídos", 3, 0, "novo"],
    ]);
    /* Dois meses zerados não viram linha. */
    expect(monthVolume([count("operations.total", 0)], [count("operations.total", 0)])).toEqual([]);
  });
});
