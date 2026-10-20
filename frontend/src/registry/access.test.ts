/**
 * A camada de sessão: o que a conta poderia oferecer.
 *
 * Complementa `allowed-actions.test.ts`. Aqui se prova a regra de visibilidade
 * por permissão, capability e disponibilidade de contrato — e, principalmente,
 * que exigência **não declarada libera**: quem protege é o servidor, e uma
 * ação sem exigência declarada não pode sumir da tela por omissão do registry.
 */
import { describe, expect, it } from "vitest";
import { accessBlockReason, allowsAccess } from "./access";

const session = (permissions: string[], capabilities: string[]) => ({
  hasPermission: (permission: string) => permissions.includes(permission),
  hasCapability: (capability: string) => capabilities.includes(capability),
  hasProductCapability: (capability: string) =>
    capability === "ORBIT_INTELLIGENCE",
  hasFeature: (feature: string) => feature === "ORBIT_INTELLIGENCE",
});

const full = session(["operations.update"], ["operations.manage"]);
const none = session([], []);

describe("allowsAccess", () => {
  it("libera quando permissão e capability estão presentes", () => {
    expect(
      allowsAccess(
        { permission: "operations.update", capability: "operations.manage" },
        full,
      ),
    ).toBe(true);
  });

  it("bloqueia por permissão ausente", () => {
    expect(allowsAccess({ permission: "operations.update" }, none)).toBe(false);
  });

  it("bloqueia por capability ausente do plano", () => {
    expect(allowsAccess({ capability: "operations.manage" }, none)).toBe(false);
  });

  it("combina entitlement canônico e disponibilidade de implementação", () => {
    expect(
      allowsAccess(
        {
          productCapability: "ORBIT_INTELLIGENCE",
          feature: "ORBIT_INTELLIGENCE",
        },
        full,
      ),
    ).toBe(true);
    expect(
      allowsAccess(
        {
          productCapability: "ORBIT_INTELLIGENCE",
          feature: "SCHEDULING_INTELLIGENCE",
        },
        full,
      ),
    ).toBe(false);
  });

  it("exigência não declarada libera", () => {
    expect(allowsAccess({}, none)).toBe(true);
  });

  it("contrato inexistente bloqueia, mesmo com todas as permissões", () => {
    expect(allowsAccess({ available: false }, full)).toBe(false);
  });

  it("pedir por um registro inexistente não revela botão", () => {
    expect(allowsAccess(undefined, full)).toBe(false);
  });
});

describe("accessBlockReason", () => {
  it("liberado não tem motivo", () => {
    expect(
      accessBlockReason({ permission: "operations.update" }, full),
    ).toBeNull();
  });

  it("bloqueado tem frase para mostrar ao usuário", () => {
    const reason = accessBlockReason({ permission: "operations.update" }, none);
    expect(typeof reason).toBe("string");
    expect(reason).not.toBe("");
  });
});
