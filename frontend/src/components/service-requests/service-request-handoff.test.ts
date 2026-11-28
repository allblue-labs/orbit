import { describe, expect, it } from "vitest";

import type { CustomerServiceRequestDetailsReadModel as ServiceRequest } from "@/types/contracts/modules/customer-service-requests/customer-service-request.read-models";
import {
  operationDescription,
  operationKind,
  quoteDraftFrom,
  quoteLinkNote,
  suggestedOperationCode,
} from "./service-request-handoff";

const chamado = (campos: Partial<ServiceRequest> = {}): ServiceRequest => ({
  id: "r-1",
  code: "CH-000123",
  category: { code: "EQUIPMENT_PROBLEM", label: "Problema no equipamento" },
  subject: "Split da recepção pingando",
  status: { code: "OPEN", label: "Aberto" },
  urgency: { code: "HIGH", label: "Alta" },
  asset: { id: "a-1", name: "Split Recepção", identifier: "SPL-01" },
  customerName: "Clínica Sol",
  assignedTo: null,
  submittedAt: "2026-11-20T10:00:00.000Z",
  updatedAt: "2026-11-20T10:00:00.000Z",
  version: 3,
  allowedActions: ["CREATE_OPERATION"],
  description: "Está pingando água sobre a mesa.",
  details: {
    equipmentCondition: { code: "MALFUNCTIONING", label: "Funcionando com defeito" },
    siteLocation: "Recepção, 2º andar",
    availability: "Manhãs",
    contactName: "Ana",
    contactPhone: "(81) 99999-0000",
  },
  requester: "Ana",
  customer: { id: "c-1", name: "Clínica Sol LTDA" },
  businessUnit: null,
  convertedOperation: null,
  timeline: [],
  closedAt: null,
  cancelledAt: null,
  ...campos,
});

describe("do chamado para o atendimento", () => {
  it("a descrição leva o pedido, os detalhes e a origem", () => {
    const texto = operationDescription(chamado());
    expect(texto).toContain("Está pingando água sobre a mesa.");
    expect(texto).toContain("Equipamento: Split Recepção · SPL-01");
    expect(texto).toContain("Situação do equipamento: Funcionando com defeito");
    expect(texto).toContain("Local: Recepção, 2º andar");
    expect(texto).toContain("Melhor horário: Manhãs");
    expect(texto).toContain("Contato no local: Ana — (81) 99999-0000");
    expect(texto).toContain("Origem: chamado CH-000123 (urgência alta)");
  });

  it("sem detalhes, não sobra linha vazia", () => {
    const texto = operationDescription(
      chamado({
        asset: null,
        urgency: { code: "NORMAL", label: "Normal" },
        details: {
          equipmentCondition: null,
          siteLocation: null,
          availability: null,
          contactName: null,
          contactPhone: null,
        },
      }),
    );
    expect(texto).toBe("Está pingando água sobre a mesa.\n\nOrigem: chamado CH-000123");
  });

  it("o tipo segue o que o cliente pediu", () => {
    expect(operationKind(chamado())).toBe("MAINTENANCE");
    expect(
      operationKind(
        chamado({ category: { code: "SERVICE_REQUEST", label: "Serviço" }, asset: null }),
      ),
    ).toBe("INSTALLATION");
    expect(operationKind(chamado({ category: { code: "QUESTION", label: "Dúvida" } }))).toBe(
      "OTHER",
    );
  });

  it("o código sugerido segue o formato das ordens", () => {
    expect(suggestedOperationCode(new Date("2026-11-21T12:00:00Z"), 42)).toBe(
      "OS-20261121-000042",
    );
  });
});

describe("do chamado para o orçamento", () => {
  it("cliente, equipamento, título e objeto vêm preenchidos", () => {
    const rascunho = quoteDraftFrom(chamado());
    expect(rascunho).toMatchObject({
      origin: "SCRATCH",
      customerId: "c-1",
      customerLabel: "Clínica Sol LTDA",
      assetIds: ["a-1"],
      title: "Split da recepção pingando",
    });
    expect(rascunho.notes).toContain("Está pingando água sobre a mesa.");
    expect(rascunho.notes).toContain("Local: Recepção, 2º andar");
    expect(rascunho.notes).toContain("Referente ao chamado CH-000123.");
    /* O telefone de quem recebe o técnico não vai para a proposta. */
    expect(rascunho.notes).not.toContain("99999");
  });

  it("a nota interna diz qual orçamento nasceu do chamado", () => {
    expect(quoteLinkNote({ code: "ORC-0007", title: "Troca do dreno" })).toBe(
      'Orçamento ORC-0007 criado a partir deste chamado — "Troca do dreno".',
    );
  });
});
