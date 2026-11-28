import { describe, expect, it } from "vitest";

import {
  financialWindow,
  flowRows,
  periodLabel,
  statusSlices,
  windowPeriods,
} from "./financial-window";

describe("recortes do fluxo financeiro", () => {
  it("7 e 15 dias terminam hoje e contam o próprio dia", () => {
    expect(financialWindow("7D", "2026-11-22")).toEqual({
      from: "2026-11-16",
      to: "2026-11-22",
      granularity: "DAY",
    });
    expect(financialWindow("15D", "2026-03-05")).toEqual({
      from: "2026-02-19",
      to: "2026-03-05",
      granularity: "DAY",
    });
  });

  it("o mês vai do primeiro ao último dia; 12 meses atravessam o ano", () => {
    expect(financialWindow("MONTH", "2026-02-10")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
      granularity: "DAY",
    });
    expect(financialWindow("12M", "2026-01-15")).toEqual({
      from: "2025-02-01",
      to: "2026-01-31",
      granularity: "MONTH",
    });
  });

  it("lista cada período do recorte", () => {
    expect(windowPeriods(financialWindow("7D", "2026-11-22"))).toHaveLength(7);
    const meses = windowPeriods(financialWindow("12M", "2026-11-22"));
    expect(meses).toHaveLength(12);
    expect(meses[0]).toBe("2025-12");
    expect(meses[11]).toBe("2026-11");
  });

  it("completa com zero os dias sem movimento", () => {
    const window = financialWindow("7D", "2026-11-22");
    const rows = flowRows(
      [
        {
          period: "2026-11-18",
          incomeConfirmed: "300.00",
          incomePending: "50.00",
          expenseConfirmed: "120.00",
          expensePending: "0.00",
          netConfirmed: "180.00",
        },
      ],
      window,
    );
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.recebido > 0)).toEqual([
      expect.objectContaining({
        period: "2026-11-18",
        label: "18/11",
        recebido: 300,
        aReceber: 50,
        pago: 120,
        saldo: 180,
      }),
    ]);
    expect(rows[0]).toMatchObject({ recebido: 0, pago: 0, saldo: 0, saldoAcumulado: 0 });
    /* O acumulado carrega o saldo para os dias seguintes. */
    expect(rows.at(-1)).toMatchObject({ saldo: 0, saldoAcumulado: 180 });
  });

  it("rótulos curtos para dia e mês", () => {
    expect(periodLabel("2026-11-03")).toBe("03/11");
    expect(periodLabel("2026-11")).toBe("nov/26");
  });

  it("a situação separa o vencido do que ainda está no prazo", () => {
    expect(
      statusSlices("INCOME", { confirmed: "1000.00", pending: "500.00", overdue: "200.00" }),
    ).toEqual([
      { key: "confirmed", label: "Recebido", value: 1000 },
      { key: "pending", label: "A receber", value: 300 },
      { key: "overdue", label: "Vencido (a cobrar)", value: 200 },
    ]);
    expect(
      statusSlices("EXPENSE", { confirmed: "0", pending: "0", overdue: "0" }).map(
        (slice) => slice.label,
      ),
    ).toEqual(["Pago", "A pagar", "Contas vencidas"]);
  });
});
