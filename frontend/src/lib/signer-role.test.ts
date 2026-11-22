import { describe, expect, it } from "vitest";

import { signerRoleLabel } from "./signer-role";

describe("papel de quem assina", () => {
  it("traduz os papéis conhecidos e nunca mostra código cru", () => {
    expect(signerRoleLabel("TECHNICIAN")).toBe("Técnico responsável");
    expect(signerRoleLabel("CUSTOMER")).toBe("Cliente");
    expect(signerRoleLabel("TECHNICAL_MANAGER")).toBe("Responsável técnico");
    expect(signerRoleLabel("ALGUM_PAPEL")).toBe("Assinante");
    expect(signerRoleLabel("Síndico")).toBe("Síndico");
  });
});
