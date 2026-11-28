import { describe, expect, it } from "vitest";

import {
  emptyDraft,
  newIdempotencyKey,
  requestPayload,
  stepProblem,
  suggestedSubject,
  timelineMilestone,
  urgencyBadge,
} from "./service-request-model";

describe("assistente de chamado (web)", () => {
  it("só categoria, assunto e descrição seguram o avanço", () => {
    const rascunho = emptyDraft();
    expect(stepProblem(0, rascunho)).toBe("Escolha do que se trata o chamado.");
    const comCategoria = { ...rascunho, category: "QUESTION" as const };
    expect(stepProblem(0, comCategoria)).toBeNull();
    expect(stepProblem(1, comCategoria)).toBeNull();
    expect(stepProblem(2, { ...comCategoria, subject: "Dúvida" })).toBe(
      "Descreva o que está acontecendo (pelo menos 5 letras).",
    );
    expect(
      stepProblem(2, {
        ...comCategoria,
        subject: "Dúvida",
        description: "Quero saber",
      }),
    ).toBeNull();
    expect(stepProblem(3, comCategoria)).toBeNull();
  });

  it("o corpo leva só o que foi preenchido", () => {
    const corpo = requestPayload({
      ...emptyDraft("Ana"),
      category: "EQUIPMENT_PROBLEM",
      subject: "  Ar parou ",
      description: " Desligou sozinho ",
      urgency: "URGENT",
      equipmentCondition: "STOPPED",
      siteLocation: "   ",
    });
    /* Sem equipamento, a condição dele não faz sentido e não vai. */
    expect(corpo).toEqual({
      category: "EQUIPMENT_PROBLEM",
      subject: "Ar parou",
      description: "Desligou sozinho",
      urgency: "URGENT",
      details: { contactName: "Ana" },
    });
    expect(
      requestPayload({
        ...emptyDraft(),
        category: "EQUIPMENT_PROBLEM",
        assetId: "a-1",
        equipmentCondition: "STOPPED",
      }).details,
    ).toEqual({ equipmentCondition: "STOPPED" });
  });

  it("sugere o assunto e gera chave válida para o servidor", () => {
    expect(suggestedSubject("MAINTENANCE", "Split Recepção")).toBe(
      "Manutenção — Split Recepção",
    );
    expect(suggestedSubject("QUESTION", null)).toBe("Tirar uma dúvida");
    expect(newIdempotencyKey()).toMatch(/^[A-Za-z0-9._:-]{8,160}$/);
  });

  it("textos de urgência e da linha do tempo", () => {
    expect(urgencyBadge("URGENT", "Urgente")).toBe("Urgente");
    expect(urgencyBadge("HIGH", "Alta")).toBe("Urgência alta");
    expect(timelineMilestone("STATUS_CHANGED", "RESOLVED")).toBe(
      "Chamado resolvido",
    );
    expect(timelineMilestone("CREATED", "OPEN")).toBe("Chamado aberto");
  });
});
