/**
 * O catálogo público.
 *
 * O que se cobra aqui é a fronteira comercial: quatro planos, a ordem certa,
 * avaliação só no Essencial, inteligência só em dois — e **nada** decidido no
 * cliente que já venha decidido do servidor.
 */
import { describe, expect, it } from "vitest";

import {
  INTELLIGENCE_CAPABILITY,
  TRIAL_DAYS,
  TRIAL_PLAN_CODE,
  ofereceAvaliacao,
  ordenarPlanos,
  temInteligencia,
} from "./pricing-catalog";
import type { PlanCatalogEntry, PlanLimit } from "@/types/billing";

const limite = (value: number | null): PlanLimit =>
  value === null
    ? { unlimited: true, value: null }
    : { unlimited: false, value };

function plano(
  code: string,
  mensal: number,
  capabilities: readonly string[] = [],
): PlanCatalogEntry {
  return {
    code,
    label: code,
    description: "",
    monthlyPrice: String(mensal / 100),
    currency: "BRL",
    prices: {
      MONTHLY: { amountMinor: mensal, currency: "BRL", formatted: "" },
    },
    capabilities,
    allocation: { PLATFORM_USERS: limite(5) },
    usage: { SERVICE_ORDERS_CREATED: limite(500) },
  };
}

describe("catálogo público", () => {
  it("ordena do mais barato ao mais caro, pelo preço publicado", () => {
    const ordenado = ordenarPlanos([
      plano("ENTERPRISE_UNLIMITED", 69_990),
      plano("ESSENTIAL", 5_990),
      plano("PROFESSIONAL_INTELLIGENCE", 24_990),
      plano("PROFESSIONAL", 14_990),
    ]);

    expect(ordenado.map((p) => p.code)).toEqual([
      "ESSENTIAL",
      "PROFESSIONAL",
      "PROFESSIONAL_INTELLIGENCE",
      "ENTERPRISE_UNLIMITED",
    ]);
  });

  it("um plano novo entra no lugar certo sem editar código", () => {
    /**
     * A ordem sai do preço, não de uma lista fixa de códigos. É o que impede
     * que um plano futuro apareça no fim da vitrine por esquecimento.
     */
    const ordenado = ordenarPlanos([
      plano("ESSENTIAL", 5_990),
      plano("PLANO_NOVO", 9_990),
      plano("PROFESSIONAL", 14_990),
    ]);

    expect(ordenado[1].code).toBe("PLANO_NOVO");
  });

  it("só o Essencial anuncia avaliação gratuita", () => {
    expect(ofereceAvaliacao(plano(TRIAL_PLAN_CODE, 5_990))).toBe(true);
    expect(ofereceAvaliacao(plano("PROFESSIONAL", 14_990))).toBe(false);
    expect(ofereceAvaliacao(plano("ENTERPRISE_UNLIMITED", 69_990))).toBe(false);
  });

  it("a avaliação é de trinta dias", () => {
    expect(TRIAL_DAYS).toBe(30);
  });

  it("inteligência vem da capacidade publicada, não do nome do plano", () => {
    /**
     * Deduzir pelo código (`endsWith('INTELLIGENCE')`) funcionaria hoje e
     * quebraria no primeiro plano com outro nome. A capacidade é o contrato.
     */
    expect(
      temInteligencia(plano("QUALQUER", 1, [INTELLIGENCE_CAPABILITY])),
    ).toBe(true);
    expect(temInteligencia(plano("PROFESSIONAL_INTELLIGENCE", 1, []))).toBe(
      false,
    );
  });
});
