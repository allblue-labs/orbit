/**
 * As janelas de comparação são aritmética de calendário — e calendário tem
 * fronteiras que só aparecem em datas específicas. Estes casos são fixos por
 * isso: um teste amarrado a `new Date()` passaria em 30 dias do mês e
 * reprovaria no restante, sem que nada tivesse mudado.
 */
import { describe, expect, it } from "vitest";

import { buildMonthComparison } from "./month-comparison";

const RECIFE = "America/Recife";

const span = (window: { from: string; to: string }) =>
  new Date(window.to).getTime() - new Date(window.from).getTime();

describe("janelas de comparação mês a mês", () => {
  it("nenhuma janela tem duração zero, inclusive no primeiro dia do mês", () => {
    /**
     * No dia 1º o mês anterior tem exatamente um dia comparável. Antes da
     * correção a janela colapsava em `from === to`, e o `/analytics` recusava
     * a consulta com 400 — um erro que só existia 12 dias por ano.
     */
    for (const day of [
      "2026-09-01",
      "2026-01-01",
      "2026-03-01",
      "2026-12-31",
      "2026-03-31",
      "2024-02-29",
    ]) {
      const windows = buildMonthComparison(
        new Date(`${day}T12:00:00Z`),
        RECIFE,
      );
      expect(span(windows.thisMonth), `mês corrente em ${day}`).toBeGreaterThan(
        0,
      );
      expect(span(windows.lastMonth), `mês anterior em ${day}`).toBeGreaterThan(
        0,
      );
    }
  });

  it("as duas janelas cobrem o mesmo trecho do mês", () => {
    /**
     * Comparar 1–17 de agosto com julho inteiro faria agosto parecer sempre
     * pior. As janelas têm de ter tamanho equivalente para a comparação
     * significar alguma coisa.
     */
    const windows = buildMonthComparison(
      new Date("2026-09-17T12:00:00Z"),
      RECIFE,
    );
    const difference = Math.abs(
      span(windows.thisMonth) - span(windows.lastMonth),
    );
    /** Uma hora de folga absorve mudança de horário de verão no caminho. */
    expect(difference).toBeLessThanOrEqual(3_600_000);
  });

  it("o mês curto é resolvido pelo último dia possível", () => {
    /** 31 de março menos um mês não é 3 de março. */
    const windows = buildMonthComparison(
      new Date("2026-03-31T12:00:00Z"),
      RECIFE,
    );
    expect(windows.lastMonth.to.slice(0, 10)).toBe("2026-03-01");
    expect(windows.lastMonth.label).toContain("fev");
  });

  it("o recorte começa no primeiro dia do mês na unidade, não em UTC", () => {
    /**
     * Em `America/Recife` são três horas de diferença: uma operação aberta às
     * 22h do dia 31 cairia no mês seguinte se a fronteira fosse UTC.
     */
    const windows = buildMonthComparison(
      new Date("2026-09-17T12:00:00Z"),
      RECIFE,
    );
    expect(windows.thisMonth.from).toBe("2026-09-01T03:00:00.000Z");
  });
});
