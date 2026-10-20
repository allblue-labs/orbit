/**
 * Situações em linguagem de produto.
 *
 * O gate é simples: nenhum identificador cru chega à tela, nem o conhecido nem
 * o que aparecer amanhã.
 */
import { describe, expect, it } from "vitest";

import { lifecycleLabel } from "./lifecycle";

describe("situação de ciclo de vida", () => {
  it("traduz as situações conhecidas", () => {
    expect(lifecycleLabel("ACTIVE")).toBe("Ativa");
    expect(lifecycleLabel("SUSPENDED")).toBe("Suspensa");
    expect(lifecycleLabel("PENDING")).toBe("Pendente");
  });

  it("concorda em gênero quando o sujeito pede", () => {
    /// "Plano ativa" está errado em português, e concordância não é detalhe.
    expect(lifecycleLabel("ACTIVE", { gender: "masculine" })).toBe("Ativo");
    expect(lifecycleLabel("CANCELLED", { gender: "masculine" })).toBe(
      "Cancelado",
    );
  });

  it("uma situação desconhecida vira texto legível, nunca o identificador", () => {
    const label = lifecycleLabel("AGUARDANDO_REVISAO");
    expect(label).toBe("Aguardando Revisao");
    expect(label).not.toContain("_");
  });

  it("não inventa rótulo para valor ausente", () => {
    expect(lifecycleLabel(null)).toBe("—");
    expect(lifecycleLabel(undefined)).toBe("—");
    expect(lifecycleLabel("")).toBe("—");
  });

  it("aceita a caixa como vier", () => {
    expect(lifecycleLabel("active")).toBe("Ativa");
    expect(lifecycleLabel(" Active ")).toBe("Ativa");
  });
});
