/**
 * As regras do atendimento de PMOC.
 *
 * O que se prova aqui é o que se erra num fluxo de quatro requisições: em que
 * passo a pessoa está, o que falta para avançar, e o que exatamente vai no
 * pedido. Nada disso depende de desenho.
 *
 * O caso mais importante é a **autoridade**: quem decide o que se pode fazer é o
 * servidor, via `allowedActions`. Se este módulo passar a deduzir isso de
 * `status`, existirão duas máquinas de estados e elas vão divergir.
 */
import { describe, expect, it } from "vitest";

import type { PmocExecutionPreparation } from "@/types/pmoc";
import {
  completePayload,
  currentStep,
  emptyDraft,
  isFinished,
  isFuture,
  startPayload,
  stepIssues,
  type AttendanceDraft,
} from "./attendance.model";

const TECNICO = "tec-1";

function preparacao(
  overrides: Partial<PmocExecutionPreparation> = {},
): PmocExecutionPreparation {
  return {
    plan: { id: "plan-1", code: "PMOC-001", name: "Anual", reviewRequired: false },
    cycle: { id: "cycle-1", dueOn: "2026-10-01", status: "PENDING" },
    customer: { id: "cust-1", name: "Edifício Aurora" },
    equipment: { id: "asset-1", name: "Split Cassete 01" },
    serviceLocation: null,
    scope: null,
    serviceTypes: [],
    procedure: {},
    procedureGroups: [],
    technicalResponsible: { id: "rt-1", displayName: "Marcos" },
    technicalResponsibleEligibility: {
      eligible: true,
      blockedReason: null,
      signatureAvailable: true,
    },
    fieldTechnicians: [
      { id: TECNICO, name: "João", signatureAvailable: true },
      { id: "tec-2", name: "Maria", signatureAvailable: false },
    ],
    auxiliaryTechnicians: [{ id: "tec-2", name: "Maria", signatureAvailable: false }],
    eligibility: { ready: true, blockedReasons: [] },
    evidencePolicy: {
      minimumPhotos: 0,
      maximumPhotos: 6,
      acceptedKinds: ["PHOTO"],
    },
    documentPolicy: { artifactType: "PMOC" },
    suggestedExecutionTime: { dueOn: "2026-10-01", timezone: "America/Recife" },
    existingExecution: null,
    allowedActions: ["START"],
    ...overrides,
  } as PmocExecutionPreparation;
}

const rascunho = (overrides: Partial<AttendanceDraft> = {}): AttendanceDraft => ({
  ...emptyDraft(TECNICO),
  reviewedProcedure: true,
  ...overrides,
});

describe("o passo de entrada vem do servidor", () => {
  it("nada aberto e liberado abre em escalar", () => {
    expect(currentStep(preparacao({ allowedActions: ["START"] }))).toBe(
      "escalar",
    );
  });

  it("em andamento abre no roteiro", () => {
    expect(
      currentStep(
        preparacao({ allowedActions: ["COMPLETE", "ADD_EVIDENCE"] }),
      ),
    ).toBe("roteiro");
  });

  it("resolvida abre em emitir", () => {
    expect(currentStep(preparacao({ allowedActions: ["VIEW"] }))).toBe(
      "emitir",
    );
  });

  /*
   * Bloqueada é `allowedActions: []` — nem START.
   *
   * Cai em emitir, que é o passo que só mostra estado. Abrir em escalar
   * ofereceria um botão cujo destino é uma recusa.
   */
  it("bloqueada não abre em escalar", () => {
    expect(currentStep(preparacao({ allowedActions: [] }))).not.toBe("escalar");
  });
});

describe("o atendimento terminou", () => {
  const concluida = {
    id: "exec-1",
    status: "COMPLETED",
    artifactExecution: { id: "art-1", code: "PMOC-1", status: "COMPLETED" },
  };

  it("só com a manutenção concluída e o documento emitido", () => {
    expect(
      isFinished(
        preparacao({
          existingExecution: concluida as never,
          allowedActions: ["VIEW"],
        }),
      ),
    ).toBe(true);
  });

  /*
   * Concluída sem documento **não** terminou.
   *
   * O trabalho existe e a prova de conformidade não — e é a prova que o cliente
   * guarda para a fiscalização.
   */
  it("concluída sem documento não terminou", () => {
    expect(
      isFinished(
        preparacao({
          existingExecution: { ...concluida, artifactExecution: null } as never,
          allowedActions: ["VIEW"],
        }),
      ),
    ).toBe(false);
  });

  it("em andamento não terminou", () => {
    expect(
      isFinished(
        preparacao({
          existingExecution: {
            ...concluida,
            status: "IN_PROGRESS",
          } as never,
        }),
      ),
    ).toBe(false);
  });

  it("sem execução nenhuma não terminou", () => {
    expect(isFinished(preparacao())).toBe(false);
  });
});

describe("o que falta em cada passo", () => {
  it("escalar exige o técnico", () => {
    expect(
      stepIssues(
        "escalar",
        rascunho({ responsibleFieldTechnicianId: null }),
        preparacao(),
      ),
    ).toContain("Escolha o técnico que vai atender este equipamento.");
  });

  it("escalar mostra o bloqueio do servidor em vez de reimplementá-lo", () => {
    const issues = stepIssues(
      "escalar",
      rascunho(),
      preparacao({
        eligibility: {
          ready: false,
          blockedReasons: ["TECHNICAL_RESPONSIBLE_WITHOUT_SIGNATURE"],
        },
      }),
    );

    /* A tela não repete a regra — ela diz que o servidor não liberou e mostra os
       motivos que ele traduziu. */
    expect(issues.length).toBeGreaterThan(0);
    expect(stepIssues("escalar", rascunho(), preparacao())).toHaveLength(0);
  });

  it("o roteiro exige a confirmação de quem percorreu", () => {
    expect(
      stepIssues("roteiro", rascunho({ reviewedProcedure: false }), preparacao()),
    ).toHaveLength(1);
    expect(stepIssues("roteiro", rascunho(), preparacao())).toHaveLength(0);
  });

  it("concluir recusa data no futuro", () => {
    const amanha = new Date(Date.now() + 24 * 3600_000)
      .toISOString()
      .slice(0, 16);

    /* A mesma recusa do servidor, dita antes de gastar a requisição. */
    expect(
      stepIssues("concluir", rascunho({ performedAt: amanha }), preparacao()),
    ).toHaveLength(1);
  });

  it("concluir sem data é válido — significa agora", () => {
    expect(
      stepIssues("concluir", rascunho({ performedAt: "" }), preparacao()),
    ).toHaveLength(0);
  });

  it("cada frase diz o campo, nunca só que não deu", () => {
    for (const frase of stepIssues(
      "escalar",
      rascunho({ responsibleFieldTechnicianId: null }),
      preparacao(),
    )) {
      expect(frase.length).toBeGreaterThan(20);
      expect(frase).toMatch(/[.!]$/);
    }
  });
});

describe("a data no futuro", () => {
  const agora = new Date("2026-10-01T12:00:00.000Z").getTime();

  it("aceita um minuto de tolerância, como o servidor", () => {
    /* Relógios de máquinas diferentes não batem no segundo; recusar por isso
       recusaria o caminho correto. */
    expect(isFuture("2026-10-01T12:00:30.000Z", agora)).toBe(false);
    expect(isFuture("2026-10-01T12:05:00.000Z", agora)).toBe(true);
  });

  it("data no passado nunca é futuro", () => {
    expect(isFuture("2026-09-01T12:00:00.000Z", agora)).toBe(false);
  });

  it("texto inválido não é futuro — não inventa recusa", () => {
    expect(isFuture("não é data", agora)).toBe(false);
    expect(isFuture("", agora)).toBe(false);
  });
});

describe("o que vai no pedido", () => {
  it("abrir leva o responsável e os auxiliares", () => {
    expect(
      startPayload(
        rascunho({ auxiliaryTechnicianIds: ["tec-2", "tec-3"] }),
      ),
    ).toEqual({
      responsibleFieldTechnicianId: TECNICO,
      auxiliaryTechnicianIds: ["tec-2", "tec-3"],
    });
  });

  it("o responsável não vai também como auxiliar", () => {
    /* Seria a mesma pessoa duas vezes. O servidor filtra; mandar limpo evita
       depender disso. */
    expect(
      startPayload(rascunho({ auxiliaryTechnicianIds: [TECNICO, "tec-2"] }))
        .auxiliaryTechnicianIds,
    ).toEqual(["tec-2"]);
  });

  it("concluir sem data deixa o agora para o servidor", () => {
    /* O relógio do navegador pode estar errado, e a hora da manutenção é registro
       legal — quem resolve "agora" é quem tem a hora autoritativa. */
    expect(completePayload(rascunho()).performedAt).toBeUndefined();
  });

  it("concluir com data manda ISO", () => {
    const payload = completePayload(
      rascunho({ performedAt: "2026-09-30T08:30" }),
    );
    expect(payload.performedAt).toMatch(/^2026-09-30T\d{2}:30:00\.000Z$/);
  });

  it("observação em branco é ausente, não string vazia", () => {
    expect(completePayload(rascunho({ notes: "   " })).notes).toBeUndefined();
    expect(completePayload(rascunho({ notes: "Dreno limpo" })).notes).toBe(
      "Dreno limpo",
    );
  });
});
