import { describe, expect, it } from "vitest";
import type { OperationHistoryEntry } from "@/types/operations";
import { presentOperationHistory } from "./operation-history.presentation";

function event(action: string, overrides: Partial<OperationHistoryEntry> = {}) {
  return {
    action,
    fromStatus: null,
    toStatus: null,
    details: null,
    ...overrides,
  };
}

describe("apresentação da linha do tempo da operação", () => {
  it("explica a preparação do documento sem expor os identificadores internos", () => {
    const result = presentOperationHistory(
      event("FIELD_DOCUMENT_PREPARED", {
        details: { artifactId: "internal-id", snapshotHash: "private-hash" },
      }),
    );
    expect(result).toEqual({
      title: "Documento do atendimento preparado",
      explanation:
        "Os dados do atendimento foram reunidos para preparar o documento.",
    });
  });

  it.each([
    ["FIELD_OPERATION_STARTED", "Atendimento iniciado"],
    ["FIELD_OPERATION_COMPLETED", "Atendimento concluído"],
    ["FIELD_EVIDENCE_ADDED", "Evidência do atendimento adicionada"],
    ["FIELD_NOTE_ADDED", "Observação do atendimento registrada"],
    ["FIELD_MATERIAL_REGISTERED", "Uso de material registrado"],
    ["RESPONSIBLE_FIELD_TECHNICIAN_REPLACED", "Técnico responsável alterado"],
    ["ASSIGNMENT_AUTHORIZATION_REVOKED", "Autorização do atendimento retirada"],
    ["CHECKLIST_UPDATED", "Checklist atualizado"],
  ])("traduz o evento %s", (action, title) => {
    expect(presentOperationHistory(event(action)).title).toBe(title);
  });

  it.each([
    "FUTURE_INTERNAL_EVENT",
    "",
    "toString",
    "constructor",
    "__proto__",
  ])("usa uma mensagem compreensível para %s", (action) => {
    expect(presentOperationHistory(event(action))).toEqual({
      title: "Atualização registrada na operação",
      explanation: undefined,
    });
  });

  it("explica a mudança de situação", () => {
    expect(
      presentOperationHistory(
        event("STATUS_CHANGED", {
          fromStatus: "SCHEDULED",
          toStatus: "IN_PROGRESS",
        }),
      ).title,
    ).toBe("Situação alterada de agendada para em execução");
  });

  it("não exibe valores de situação desconhecidos", () => {
    expect(
      presentOperationHistory({
        action: "STATUS_CHANGED",
        fromStatus: "INTERNAL_STATUS",
        toStatus: "UNKNOWN_STATUS",
        details: null,
      }).title,
    ).toBe("Situação da operação alterada");
  });

  it("distingue checklist atualizado de concluído e mostra o progresso", () => {
    expect(
      presentOperationHistory(
        event("FIELD_CHECKLIST_UPDATED", {
          details: { completed: false, progress: 50 },
        }),
      ),
    ).toEqual({
      title: "Checklist atualizado em campo",
      explanation: "50% do checklist preenchido.",
    });
    expect(
      presentOperationHistory(
        event("FIELD_CHECKLIST_UPDATED", {
          details: { completed: true, progress: 100 },
        }),
      ),
    ).toEqual({
      title: "Checklist concluído em campo",
      explanation: "100% do checklist preenchido.",
    });
  });

  it.each([
    null,
    [],
    "raw-payload",
    { progress: "50" },
    { progress: 101 },
    { progress: NaN },
  ])("ignora detalhes sem formato válido", (details) => {
    expect(
      presentOperationHistory(event("FIELD_CHECKLIST_UPDATED", { details }))
        .explanation,
    ).toBeUndefined();
  });

  it("só anuncia assinatura quando ela foi registrada", () => {
    expect(
      presentOperationHistory(
        event("CUSTOMER_ACKNOWLEDGEMENT_CAPTURED", {
          details: { hasSignature: false },
        }),
      ).title,
    ).toBe("Confirmação do cliente registrada");
    expect(
      presentOperationHistory(
        event("CUSTOMER_ACKNOWLEDGEMENT_CAPTURED", {
          details: { hasSignature: true },
        }),
      ).title,
    ).toBe("Assinatura do cliente registrada");
  });
});
