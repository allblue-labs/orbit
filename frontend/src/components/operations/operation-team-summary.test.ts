import { describe, expect, it } from "vitest";

import { resumoDaEquipe } from "./operation-team-summary";

const pessoa = (displayName: string) => ({ displayName });
const auxiliar = (displayName: string) => ({ user: pessoa(displayName) });

describe("o resumo da equipe na listagem", () => {
  /**
   * O defeito relatado, em um teste.
   *
   * O atendimento tinha Eduardo Queiroz atribuído, chegava no celular dele, e a
   * listagem dizia "Sem técnico" — porque lia `operation.users`, que a criação não
   * preenche. Quem criou concluiu que a atribuição não funcionou.
   */
  it("mostra o responsável atribuído na criação", () => {
    expect(
      resumoDaEquipe({
        responsibleFieldTechnician: pessoa("Eduardo Queiroz"),
        auxiliaryTechnicians: [],
      }),
    ).toBe("Eduardo Queiroz");
  });

  it("soma os auxiliares ao nome do responsável", () => {
    expect(
      resumoDaEquipe({
        responsibleFieldTechnician: pessoa("Eduardo Queiroz"),
        auxiliaryTechnicians: [auxiliar("Ana"), auxiliar("Bruno")],
      }),
    ).toBe("Eduardo Queiroz +2");
  });

  it("sem ninguém, diz que não há técnico", () => {
    expect(
      resumoDaEquipe({
        responsibleFieldTechnician: null,
        auxiliaryTechnicians: [],
      }),
    ).toBe("Sem técnico");
  });

  /** Campos ausentes no contrato não podem virar "undefined" na tela. */
  it("campos ausentes contam como ninguém", () => {
    expect(resumoDaEquipe({})).toBe("Sem técnico");
  });

  /**
   * Auxiliar sem responsável não acontece — o servidor recusa —, mas se
   * acontecesse, dizer "Sem técnico" esconderia gente atribuída.
   */
  it("auxiliar sem responsável ainda é contado", () => {
    expect(
      resumoDaEquipe({
        responsibleFieldTechnician: null,
        auxiliaryTechnicians: [auxiliar("Ana")],
      }),
    ).toBe("1 auxiliar");
  });

  it("dois auxiliares sem responsável concordam no plural", () => {
    expect(
      resumoDaEquipe({
        auxiliaryTechnicians: [auxiliar("Ana"), auxiliar("Bruno")],
      }),
    ).toBe("2 auxiliares");
  });

  /** Nome em branco é o mesmo que nome ausente: não vira célula vazia. */
  it("nome em branco conta como ninguém", () => {
    expect(
      resumoDaEquipe({
        responsibleFieldTechnician: pessoa("   "),
        auxiliaryTechnicians: [],
      }),
    ).toBe("Sem técnico");
  });
});
