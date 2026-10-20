/**
 * Aritmética de mês, que é onde o recorte quebra.
 *
 * "Mês passado" em 1º de março tem de ser fevereiro inteiro — e fevereiro tem 28
 * ou 29 dias. Em janeiro, tem de ser dezembro do ano anterior. Um relatório com
 * o período errado não parece errado: parece um mês fraco.
 */
import { describe, expect, it } from "vitest";

import { formatDayRange, periodFor } from "./period";

describe("periodFor", () => {
  it("mês passado é o mês anterior inteiro, com o último dia certo", () => {
    expect(periodFor("mes-passado", new Date("2026-03-15T10:00:00Z"))).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("acerta o fevereiro de ano bissexto", () => {
    /* 2024 é bissexto: 29 dias. Um cálculo com 28 fixo perderia o dia 29, e o
       relatório sairia com um dia de operação a menos. */
    expect(periodFor("mes-passado", new Date("2024-03-10T10:00:00Z")).to).toBe(
      "2024-02-29",
    );
  });

  it("vira o ano: mês passado em janeiro é dezembro do ano anterior", () => {
    expect(periodFor("mes-passado", new Date("2026-01-05T10:00:00Z"))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("mês atual começa no dia 1 e termina hoje, não no fim do mês", () => {
    /* Terminar no dia 31 incluiria dias que ainda não aconteceram, e o
       relatório diria que a operação parou. */
    expect(periodFor("mes-atual", new Date("2026-03-15T10:00:00Z"))).toEqual({
      from: "2026-03-01",
      to: "2026-03-15",
    });
  });

  it("30 dias conta para trás a partir de hoje, atravessando o mês", () => {
    expect(periodFor("30d", new Date("2026-03-15T10:00:00Z"))).toEqual({
      from: "2026-02-13",
      to: "2026-03-15",
    });
  });

  it("90 dias é mais longo que 30, e atravessa o ano", () => {
    expect(periodFor("90d", new Date("2026-02-15T10:00:00Z"))).toEqual({
      from: "2025-11-17",
      to: "2026-02-15",
    });
  });

  it("não deixa o fim do recorte antes do começo", () => {
    const hoje = new Date("2026-01-01T00:30:00Z");
    for (const preset of ["30d", "90d", "mes-atual", "mes-passado"] as const) {
      const range = periodFor(preset, hoje);
      expect(range.from <= range.to).toBe(true);
    }
  });
});

describe("formatDayRange", () => {
  it("escreve no formato brasileiro", () => {
    expect(formatDayRange({ from: "2026-02-01", to: "2026-02-28" })).toBe(
      "01/02/2026 a 28/02/2026",
    );
  });
});
