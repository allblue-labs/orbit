import { describe, expect, it } from "vitest";

import type { CustomerAccessIdentity } from "@/types/customer-portal-access";
import {
  accessEmailPreview,
  accessShareMessage,
  accessStatusText,
} from "./customer-access.model";

const identity = (
  campos: Partial<CustomerAccessIdentity>,
): CustomerAccessIdentity => ({
  id: "id",
  email: "clinica.sol@clima-norte.com",
  displayName: "Clínica Sol",
  status: "active",
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: "2026-11-20T10:00:00.000Z",
  ...campos,
});

describe("acesso do cliente", () => {
  it("a prévia usa o domínio da organização, como o servidor", () => {
    expect(accessEmailPreview("Clínica Sol", "clima-norte.com")).toBe(
      "clinica.sol@clima-norte.com",
    );
    /* Colar um endereço inteiro aproveita o nome e mantém o domínio. */
    expect(accessEmailPreview("joao@gmail.com", "clima-norte.com")).toBe(
      "joao@clima-norte.com",
    );
    expect(accessEmailPreview("!!!", "clima-norte.com")).toBeNull();
    expect(accessEmailPreview("sol", null)).toBeNull();
  });

  it("diz em que pé está o acesso", () => {
    const data = (iso: string) => iso.slice(0, 10);
    expect(accessStatusText(identity({ mustChangePassword: true }), data)).toBe(
      "Aguardando o primeiro acesso do cliente.",
    );
    expect(
      accessStatusText(
        identity({ lastLoginAt: "2026-11-19T12:00:00.000Z" }),
        data,
      ),
    ).toBe("Último acesso em 2026-11-19.");
    expect(accessStatusText(identity({ status: "disabled" }), data)).toBe(
      "Acesso desativado.",
    );
  });

  it("a mensagem leva e-mail, senha e o caminho de entrada", () => {
    const mensagem = accessShareMessage({
      identity: identity({}),
      temporaryPassword: "ABCD-EFGH-JKLM",
    });
    expect(mensagem).toContain("clinica.sol@clima-norte.com");
    expect(mensagem).toContain("ABCD-EFGH-JKLM");
    expect(mensagem).toContain("Sou cliente");
    expect(
      accessShareMessage(
        { identity: identity({}), temporaryPassword: "X" },
        "https://orbit.allblue-labs.com/portal",
      ),
    ).toContain("https://orbit.allblue-labs.com/portal");
  });
});
