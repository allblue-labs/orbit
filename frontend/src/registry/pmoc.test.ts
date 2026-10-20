/**
 * A tradução do PMOC para a tela.
 *
 * Apresentação, e só. Nada aqui decide se um plano pode ser ativado, se um
 * ciclo venceu ou se uma execução pode começar — isso é do servidor, e um
 * teste do tipo "dueOn < hoje → atrasado" reconstruiria no navegador a regra
 * de conformidade que o backend calcula contra o relógio dele.
 */
import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_STATUS,
  CYCLE_STATUS,
  DOCUMENT_STATUS,
  EQUIPMENT_EXECUTION_STATUS,
  EXECUTION_BLOCKED_REASONS,
  PLAN_STATUS,
  complianceStatus,
  cycleStatus,
  documentStatus,
  equipmentExecutionStatus,
  executionBlockedLabel,
  planStatus,
} from "./pmoc";
import { knownBlockedReason } from "./professional";

const ALL_MAPS = {
  PLAN_STATUS,
  COMPLIANCE_STATUS,
  CYCLE_STATUS,
  EQUIPMENT_EXECUTION_STATUS,
  DOCUMENT_STATUS,
};

describe("mapas de apresentação", () => {
  it("nenhum rótulo publicado é um código de contrato", () => {
    for (const [name, map] of Object.entries(ALL_MAPS)) {
      for (const [code, presentation] of Object.entries(map)) {
        expect(
          presentation.label,
          `${name}.${code} sem rótulo humano`,
        ).not.toMatch(/[A-Z]{3,}_|^[A-Z_]+$/);
      }
    }
  });

  it("os quatro conceitos têm vocabulário próprio", () => {
    /**
     * "Concluído" (ciclo) e "Concluída" (execução) concordam com o substantivo
     * de cada um — e "Ativo" é do plano, não do ciclo. Rótulos compartilhados
     * entre os conceitos apagariam a distinção que o domínio faz.
     */
    expect(planStatus("ACTIVE").label).toBe("Ativo");
    expect(cycleStatus("COMPLETED").label).toBe("Concluído");
    expect(equipmentExecutionStatus("COMPLETED").label).toBe("Concluída");
    expect(equipmentExecutionStatus("IN_PROGRESS").label).toBe("Em execução");
  });

  it("conformidade fala de vencimento, não de estado do contrato", () => {
    expect(complianceStatus("UP_TO_DATE").label).toBe("Em dia");
    expect(complianceStatus("DUE_SOON").label).toBe("Vence em breve");
    expect(complianceStatus("OVERDUE").label).toBe("Atrasado");
    expect(complianceStatus("OVERDUE").tone).toBe("critical");
  });

  it("documento tem estados próprios", () => {
    expect(documentStatus("COMPLETED").label).toBe("Emitido");
  });

  it("código desconhecido vira traço, nunca o próprio código", () => {
    for (const accessor of [
      planStatus,
      complianceStatus,
      cycleStatus,
      equipmentExecutionStatus,
      documentStatus,
    ]) {
      expect(accessor("ALGO_NOVO").label).toBe("—");
      expect(accessor(null).label).toBe("—");
      expect(accessor(undefined).label).toBe("—");
    }
  });
});

describe("bloqueios de execução", () => {
  it("todo motivo do PMOC tem frase acionável", () => {
    for (const [code, phrase] of Object.entries(EXECUTION_BLOCKED_REASONS)) {
      expect(phrase, `motivo sem tradução: ${code}`).not.toContain(code);
      expect(phrase).toMatch(/[a-záéíóúãõç]/i);
    }
  });

  it("traduz os códigos que o preparo de execução publica", () => {
    expect(
      executionBlockedLabel("PLAN_NOT_ACTIVE", knownBlockedReason),
    ).toMatch(/plano não está ativo/i);
    expect(
      executionBlockedLabel("EQUIPMENT_INACTIVE", knownBlockedReason),
    ).toMatch(/equipamento está inativo/i);
  });

  it("encadeia com o domínio profissional em vez de duplicá-lo", () => {
    /**
     * `SIGNATURE_MISSING` vem da elegibilidade do Responsável Técnico (PR-27)
     * e já tem tradução lá. Repetir a frase aqui criaria dois mapas para o
     * mesmo código, e eles divergiriam na primeira revisão de texto.
     */
    expect(executionBlockedLabel("SIGNATURE_MISSING", knownBlockedReason)).toBe(
      "Assinatura profissional não cadastrada.",
    );
  });

  it("código sem tradução em lugar nenhum cai no texto genérico", () => {
    const label = executionBlockedLabel("MOTIVO_NOVO", knownBlockedReason);
    expect(label).not.toContain("MOTIVO_NOVO");
    expect(label).toMatch(/indisponível/i);
  });
});

describe("apresentação do ciclo de vida", () => {
  /**
   * O que se testa é a **tradução da resposta do servidor**, não a regra.
   *
   * `allowedTransitions` chega pronto; aqui se prova que cada destino publicado
   * tem título, frase de efeito e rótulo em português — e que a frase descreve
   * o que o domínio garante, sem prometer efeito não contratado.
   */
  const TRANSITION_LABELS: Readonly<Record<string, string>> = {
    ACTIVE: "Ativar",
    SUSPENDED: "Suspender",
    CANCELLED: "Cancelar plano",
  };

  it("todo destino de transição tem rótulo de produto", () => {
    for (const [code, label] of Object.entries(TRANSITION_LABELS)) {
      expect(label, `transição sem rótulo: ${code}`).not.toBe(code);
      expect(label).not.toMatch(/[A-Z]{3,}_|^[A-Z]+$/);
    }
  });

  it("o estado do plano e o destino da transição usam o mesmo vocabulário", () => {
    /**
     * "Suspender" leva a "Suspenso". Se os dois mapas divergissem, o usuário
     * clicaria em uma palavra e veria outra — e ninguém saberia se funcionou.
     */
    expect(planStatus("ACTIVE").label).toBe("Ativo");
    expect(planStatus("SUSPENDED").label).toBe("Suspenso");
    expect(planStatus("CANCELLED").label).toBe("Cancelado");
  });

  /**
   * A cor responde "este plano está trabalhando?".
   *
   * Cancelado era `neutral`, com o argumento de que é histórico e não erro — nada a
   * corrigir, nada a alarmar. O argumento continua verdadeiro, e perdeu: com ele,
   * três dos cinco estados eram cinza, e na coluna Situação não se distinguia um
   * contrato morto de um rascunho que nunca começou. A cor ali não é alarme, é
   * estado — e os dois casos pedem decisões opostas.
   *
   * Atraso continua sendo o selo de conformidade, que é outro chip na mesma linha.
   */
  it("cada estado do contrato tem o tom do que ele é", () => {
    expect(planStatus("ACTIVE").tone).toBe("success");
    expect(planStatus("SUSPENDED").tone).toBe("warning");
    expect(planStatus("CANCELLED").tone).toBe("critical");
  });

  /**
   * Rascunho e Encerrado ficam quietos.
   *
   * Um é "ainda não", o outro é "já foi"; nenhum pede atenção, e pintá-los gastaria
   * cor onde não há decisão a tomar.
   */
  it("os estados sem decisão a tomar não gastam cor", () => {
    expect(planStatus("DRAFT").tone).toBe("neutral");
    expect(planStatus("EXPIRED").tone).toBe("neutral");
  });

  /**
   * Nenhum tom serve a dois estados que pedem decisões diferentes.
   *
   * É a propriedade que faz a coluna ser legível de longe — e a que reprova se
   * alguém reaproximar os tons.
   */
  it("ativo, suspenso e cancelado não compartilham tom", () => {
    const tons = ["ACTIVE", "SUSPENDED", "CANCELLED"].map(
      (status) => planStatus(status).tone,
    );
    expect(new Set(tons).size).toBe(3);
  });

  it("o plano suspenso descreve o impacto que o domínio garante", () => {
    const description = PLAN_STATUS.SUSPENDED.description ?? "";
    expect(description).toMatch(/ciclo/i);
    /** Não promete pausar agenda nem avisar ninguém — o contrato não diz isso. */
    expect(description).not.toMatch(/notifica|e-mail|agenda/i);
  });
});
