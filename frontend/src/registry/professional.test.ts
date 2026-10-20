/**
 * A tradução do domínio profissional para a tela.
 *
 * O que se prova aqui é apresentação: código do backend vira frase em
 * português, papel vira rótulo, credencial vira etiqueta. **Não** se prova
 * elegibilidade — quem decide se alguém pode assinar é o servidor, e um teste
 * do tipo "tem credencial → é elegível" reconstruiria aqui a regra que a
 * PR-FE-02 existe para não duplicar.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOCATION_ROLES,
  BLOCKED_REASONS,
  allocationRoleLabel,
  assignmentAuthorityLabel,
  blockedReasonLabel,
  credentialLabel,
  professionalRoleLabel,
  professionalRoleLabels,
  PROFESSIONAL_ROLES,
  signatureStatusLabel,
} from "./professional";
import type { ProfessionalCredential } from "@/types/workforce";

describe("papéis profissionais", () => {
  it("usa os nomes do produto, não os do contrato", () => {
    expect(professionalRoleLabel("FIELD_TECHNICIAN")).toBe(
      "Técnico Operacional",
    );
    expect(professionalRoleLabel("TECHNICAL_RESPONSIBLE")).toBe(
      "Responsável Técnico",
    );
  });

  /**
   * Um nome não é a reordenação do outro.
   *
   * O produto tinha "Técnico responsável" no formulário de operação e "Responsável
   * Técnico" no PMOC: as **mesmas duas palavras**, em ordens diferentes, para coisas
   * opostas — um executa no cliente, o outro responde pelo contrato e assina com a
   * credencial que a norma exige. Trocar a ordem das palavras não é nomear.
   *
   * Os dois compartilham "técnico" por natureza, e isso é certo: os dois são
   * técnicos. O que não pode é o conjunto de palavras ser o mesmo — é essa a
   * armadilha, e é ela que a asserção tranca.
   */
  it("um rótulo não é a reordenação do outro", () => {
    const palavras = (texto: string) =>
      [...new Set(texto.toLocaleLowerCase("pt-BR").split(/\s+/))].sort();
    expect(palavras(professionalRoleLabel("FIELD_TECHNICIAN"))).not.toEqual(
      palavras(professionalRoleLabel("TECHNICAL_RESPONSIBLE")),
    );
  });

  /** Cada papel se explica sem a tela: é o texto que a dica de contexto mostra. */
  it("cada papel tem descrição própria", () => {
    expect(PROFESSIONAL_ROLES.FIELD_TECHNICIAN.description).toContain(
      "executa",
    );
    expect(PROFESSIONAL_ROLES.TECHNICAL_RESPONSIBLE.description).toContain(
      "assina",
    );
    expect(PROFESSIONAL_ROLES.FIELD_TECHNICIAN.description).not.toBe(
      PROFESSIONAL_ROLES.TECHNICAL_RESPONSIBLE.description,
    );
  });

  it("quem acumula os dois papéis recebe os dois rótulos", () => {
    expect(
      professionalRoleLabels(["FIELD_TECHNICIAN", "TECHNICAL_RESPONSIBLE"]),
    ).toEqual(["Técnico Operacional", "Responsável Técnico"]);
  });

  it("sem papel não inventa um terceiro nome", () => {
    expect(professionalRoleLabels([])).toEqual([]);
    expect(professionalRoleLabels(undefined)).toEqual([]);
  });
});

describe("motivos de bloqueio", () => {
  it("todo motivo do contrato tem frase em português", () => {
    /**
     * O teste que impede o vazamento: se o backend publicar um motivo novo e
     * ninguém traduzir, a chave aparece aqui — não na tela do usuário.
     */
    for (const [code, phrase] of Object.entries(BLOCKED_REASONS)) {
      expect(phrase, `motivo sem tradução: ${code}`).toMatch(/[a-záéíóúãõç]/i);
      expect(phrase).not.toBe(code);
      expect(phrase).not.toMatch(/[A-Z]{3,}_/);
    }
  });

  it("traduz cada motivo publicado", () => {
    expect(blockedReasonLabel("SIGNATURE_MISSING")).toBe(
      "Assinatura profissional não cadastrada.",
    );
    expect(blockedReasonLabel("BUSINESS_UNIT_SCOPE_MISSING")).toBe(
      "Não atua na unidade deste atendimento.",
    );
  });

  it("sem bloqueio não há frase", () => {
    expect(blockedReasonLabel(null)).toBeNull();
    expect(blockedReasonLabel(undefined)).toBeNull();
  });

  it("motivo desconhecido cai no texto genérico, nunca no código", () => {
    const label = blockedReasonLabel("ALGO_QUE_O_BACKEND_INVENTOU" as never);
    expect(label).toBeTruthy();
    expect(label).not.toContain("ALGO_QUE_O_BACKEND_INVENTOU");
  });
});

describe("credenciais", () => {
  const credential = (
    overrides: Partial<ProfessionalCredential> = {},
  ): ProfessionalCredential => ({
    id: "01a0",
    type: "CREA",
    registrationNumber: "12345-D",
    region: "PE",
    issuingAuthority: null,
    displayLabel: null,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    revokedAt: null,
    ...overrides,
  });

  it("prefere o rótulo que o backend publicou", () => {
    expect(
      credentialLabel(credential({ displayLabel: "CREA-PE 12345-D" })),
    ).toBe("CREA-PE 12345-D");
  });

  it("monta a etiqueta a partir dos campos do contrato quando não há rótulo", () => {
    expect(credentialLabel(credential())).toBe("CREA 12345-D/PE");
    expect(credentialLabel(credential({ region: null }))).toBe("CREA 12345-D");
  });

  it("sem credencial não há etiqueta", () => {
    expect(credentialLabel(null)).toBeNull();
    expect(credentialLabel(undefined)).toBeNull();
  });
});

describe("assinatura", () => {
  it("declara os dois estados sem alarmismo", () => {
    expect(signatureStatusLabel(true)).toBe("Assinatura cadastrada");
    expect(signatureStatusLabel(false)).toBe("Assinatura não cadastrada");
  });
});

describe("alocação na agenda", () => {
  it("traduz os papéis que o contrato publica", () => {
    expect(allocationRoleLabel("RESPONSIBLE_FIELD_TECHNICIAN")).toBe(
      "Responsável",
    );
    expect(allocationRoleLabel("AUXILIARY_TECHNICIAN")).toBe(
      "Auxiliar técnico",
    );
  });

  it("código desconhecido não vira rótulo cru", () => {
    expect(allocationRoleLabel("SOMETHING_NEW")).toBeNull();
    expect(allocationRoleLabel(null)).toBeNull();
  });

  it("nenhum rótulo publicado é um enum", () => {
    for (const label of Object.values(ALLOCATION_ROLES)) {
      expect(label).not.toMatch(/[A-Z]{3,}_/);
    }
  });
});

describe("autoridade do vínculo", () => {
  it("explica quem manda, em linguagem de negócio", () => {
    expect(assignmentAuthorityLabel("OPERATION")).toBe(
      "Definido pelo atendimento",
    );
    expect(assignmentAuthorityLabel("SCHEDULING")).toBe(
      "Definido nesta agenda",
    );
  });

  it("valor desconhecido não aparece", () => {
    expect(assignmentAuthorityLabel("OUTRO")).toBeNull();
  });
});
