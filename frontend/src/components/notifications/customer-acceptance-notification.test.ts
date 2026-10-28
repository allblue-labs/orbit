import { describe, expect, it } from "vitest";
import { notificationCategory } from "./notification-presentation";
import {
  readResourceReference,
  resourceHref,
} from "@/entities/resource-reference";

describe("notificações de aceite do cliente", () => {
  it.each([
    ["QUOTE_CUSTOMER_APPROVED", "Orçamento aprovado"],
    ["QUOTE_CUSTOMER_REJECTED", "Orçamento recusado"],
    ["QUOTE_CUSTOMER_CHANGES_REQUESTED", "Alterações no orçamento"],
    ["PMOC_CONTRACT_SIGNED", "Contrato PMOC assinado"],
  ])("traduz %s no sino e no filtro da central", (type, label) => {
    expect(notificationCategory(type!).label).toBe(label);
  });
  it.each([
    ["quote", "/orcamentos/registro-1"],
    ["pmoc-plan", "/pmoc/registro-1"],
  ])("abre o documento relacionado a %s", (entityType, href) => {
    const reference = readResourceReference({
      entityType,
      entityId: "registro-1",
      signerName: "Cliente",
    });
    expect(reference).not.toBeNull();
    expect(resourceHref(reference!)).toBe(href);
  });
});
