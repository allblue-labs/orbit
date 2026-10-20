/**
 * O gate da CTA de cadastro, na definição real.
 *
 * `access.test.ts` prova a regra de visibilidade com definições sintéticas.
 * Aqui se prova a entrada que a tela de Clientes consulta de verdade: se o
 * registry deixasse de exigir `customers.create` ou `crm.manage`, o botão
 * apareceria para quem o `CustomerController` recusaria.
 */
import { describe, expect, it } from "vitest";

import { allowsAccess } from "@/registry/access";
import { resolveAction } from "./action-registry";

const session = (permissions: string[], capabilities: string[]) => ({
  hasPermission: (permission: string) => permissions.includes(permission),
  hasCapability: (capability: string) => capabilities.includes(capability),
});

const create = resolveAction("customer.create");
const update = resolveAction("customer.update");

describe("customer.create", () => {
  it("exige o mesmo par que o controlador: customers.create e crm.manage", () => {
    expect(create.permission).toBe("customers.create");
    expect(create.capability).toBe("crm.manage");
  });

  it("é oferecida a quem tem os dois", () => {
    expect(
      allowsAccess(create, session(["customers.create"], ["crm.manage"])),
    ).toBe(true);
  });

  it("some para quem não tem a permissão", () => {
    expect(allowsAccess(create, session([], ["crm.manage"]))).toBe(false);
  });

  it("some para o plano sem a capability", () => {
    expect(allowsAccess(create, session(["customers.create"], []))).toBe(false);
  });

  it("some para quem não tem nada", () => {
    expect(allowsAccess(create, session([], []))).toBe(false);
  });

  it("fala a língua do produto", () => {
    expect(create.label).toBe("Novo cliente");
  });
});

describe("customer.update", () => {
  it("exige customers.update, e não a de cadastro", () => {
    expect(update.permission).toBe("customers.update");
    expect(allowsAccess(update, session(["customers.create"], ["crm.manage"])))
      .toBe(false);
  });
});
