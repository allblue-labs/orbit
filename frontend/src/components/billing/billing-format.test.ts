import { describe, expect, it } from "vitest";

import {
  diasAte,
  equivalenteMensal,
  faixaDeUso,
  formatCentavos,
  formatConsumo,
  formatLimite,
  percentualDeUso,
  rotuloDoRecurso,
  rotuloDoStatus,
} from "./billing-format";
import type { ResourceEntitlement } from "@/types/billing";

/**
 * O `Intl` usa espaço **não separável** entre símbolo e número — é a
 * tipografia certa, porque impede que "R$" quebre para uma linha e o valor
 * fique noutra. Aqui ele é normalizado só para a comparação ficar legível.
 */
const semNbsp = (valor: string | null) =>
  valor?.replace(/\u00a0/g, " ") ?? null;

const recurso = (
  current: number,
  limit: ResourceEntitlement["limit"],
): ResourceEntitlement => ({
  resource: "PLATFORM_USERS",
  current,
  limit,
  remaining: limit.unlimited ? null : Math.max(0, limit.value - current),
});

describe("apresentação de cobrança", () => {
  it("formata centavos como moeda brasileira", () => {
    expect(semNbsp(formatCentavos(5990))).toBe("R$ 59,90");
    expect(semNbsp(formatCentavos(149900))).toBe("R$ 1.499,00");
    expect(semNbsp(formatCentavos(0))).toBe("R$ 0,00");
  });

  it("mostra ilimitado como palavra, nunca como número mágico", () => {
    const texto = formatLimite({ unlimited: true, value: null });
    expect(texto).toBe("Ilimitado");
    expect(texto).not.toMatch(/null|-1|999999/);
  });

  it("justapõe uso e teto sem calcular nada", () => {
    expect(formatConsumo(recurso(14, { unlimited: false, value: 20 }))).toBe(
      "14 de 20",
    );
    expect(formatConsumo(recurso(347, { unlimited: false, value: 1000 }))).toBe(
      "347 de 1.000",
    );
    expect(formatConsumo(recurso(1282, { unlimited: true, value: null }))).toBe(
      "1.282 · ilimitado",
    );
  });

  it("consumo zero renderiza como zero, e não como vazio", () => {
    expect(formatConsumo(recurso(0, { unlimited: false, value: 500 }))).toBe(
      "0 de 500",
    );
    expect(percentualDeUso(recurso(0, { unlimited: false, value: 500 }))).toBe(
      0,
    );
  });

  it("ilimitado não tem proporção", () => {
    expect(
      percentualDeUso(recurso(9999, { unlimited: true, value: null })),
    ).toBe(null);
  });

  it("a barra não transborda quando o uso passa do teto", () => {
    // Passar do teto é decisão do servidor; a barra não conta isso vazando.
    expect(percentualDeUso(recurso(24, { unlimited: false, value: 20 }))).toBe(
      100,
    );
  });

  it("teto zero não divide por zero", () => {
    expect(percentualDeUso(recurso(0, { unlimited: false, value: 0 }))).toBe(0);
    expect(percentualDeUso(recurso(1, { unlimited: false, value: 0 }))).toBe(
      100,
    );
  });

  it("as faixas visuais são só apresentação", () => {
    expect(faixaDeUso(10)).toBe("normal");
    expect(faixaDeUso(69)).toBe("normal");
    expect(faixaDeUso(70)).toBe("atencao");
    expect(faixaDeUso(89)).toBe("atencao");
    expect(faixaDeUso(90)).toBe("alto");
    expect(faixaDeUso(null)).toBe("normal");
  });

  it("o equivalente mensal é derivado, e não existe no mensal", () => {
    expect(equivalenteMensal(5990, "MONTHLY")).toBe(null);
    expect(semNbsp(equivalenteMensal(59900, "ANNUAL"))).toBe("R$ 49,92");
    expect(semNbsp(equivalenteMensal(32940, "SEMIANNUAL"))).toBe("R$ 54,90");
  });

  it("traduz o estado da assinatura", () => {
    expect(rotuloDoStatus("PENDING_PAYMENT")).toBe("Aguardando contratação");
    expect(rotuloDoStatus("TRIALING")).toBe("Período de teste");
    expect(rotuloDoStatus("GRACE_PERIOD")).toBe("Período de regularização");
    expect(rotuloDoStatus("SUSPENDED")).toBe("Suspensa");
  });

  it("estado desconhecido não vaza o código cru", () => {
    expect(rotuloDoStatus("ESTADO_NOVO_DO_BACKEND")).toBe("Assinatura");
  });

  it("preserva o wording aprovado dos recursos", () => {
    expect(rotuloDoRecurso("FIELD_TECHNICIANS")).toBe("Técnicos operadores");
    expect(rotuloDoRecurso("AUXILIARY_TECHNICIANS")).toBe("auxiliares técnico");
    expect(rotuloDoRecurso("SERVICE_ORDERS_CREATED")).toBe("Ordens de serviço");
  });

  it("conta dias a partir da data do servidor", () => {
    const agora = new Date("2026-10-03T00:00:00.000Z");
    expect(diasAte("2026-10-15T00:00:00.000Z", agora)).toBe(12);
    expect(diasAte("2026-10-01T00:00:00.000Z", agora)).toBe(0);
  });
});
