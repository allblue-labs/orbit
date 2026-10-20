import { describe, expect, it } from "vitest";

import {
  avisoDoResponsavelTecnico,
  responsavelTecnicoPadrao,
  type CandidatoRT,
} from "./pmoc-technical-responsible";

const pessoa = (
  id: string,
  name: string,
  signatureAvailable = true,
): CandidatoRT => ({ id, name, signatureAvailable });

const dono = pessoa("dono", "Darlan Simplicio");
const outro = pessoa("outro", "Ana Souza");

describe("o Responsável Técnico padrão", () => {
  /** É ele na esmagadora maioria dos casos; abrir vazio faria todos se escolherem. */
  it("é o dono, quando elegível", () => {
    expect(responsavelTecnicoPadrao([outro, dono], "dono")).toBe("dono");
  });

  it("o dono vem mesmo não sendo o primeiro da lista", () => {
    expect(responsavelTecnicoPadrao([outro, dono], "dono")).toBe("dono");
  });

  /**
   * O dono pode ter desligado a si mesmo no perfil profissional — aí ele não está
   * entre os candidatos, e insistir nele deixaria o campo apontando para quem o
   * servidor vai recusar.
   */
  it("dono fora da lista cai no primeiro com assinatura", () => {
    const semAssinatura = pessoa("sem", "Bruno Lima", false);
    expect(responsavelTecnicoPadrao([semAssinatura, outro], "dono")).toBe(
      "outro",
    );
  });

  /**
   * Pré-selecionar quem não tem assinatura produziria um plano que trava na
   * execução sem ninguém ter escolhido isso.
   */
  it("prefere quem tem assinatura", () => {
    const semAssinatura = pessoa("sem", "Bruno Lima", false);
    expect(responsavelTecnicoPadrao([semAssinatura, outro], null)).toBe(
      "outro",
    );
  });

  /** Ninguém com assinatura: o primeiro ainda é melhor que vazio, e a tela avisa. */
  it("sem ninguém assinando, usa o primeiro", () => {
    const a = pessoa("a", "A", false);
    const b = pessoa("b", "B", false);
    expect(responsavelTecnicoPadrao([a, b], null)).toBe("a");
  });

  it("lista vazia não escolhe ninguém", () => {
    expect(responsavelTecnicoPadrao([], "dono")).toBe("");
  });

  /** Sessão sem dono identificado não quebra a escolha. */
  it("sem dono informado, prefere quem assina", () => {
    expect(responsavelTecnicoPadrao([dono, outro], null)).toBe("dono");
  });
});

describe("o aviso do Responsável Técnico", () => {
  it("escolha com assinatura não gera aviso", () => {
    expect(avisoDoResponsavelTecnico([dono], "dono")).toBeNull();
  });

  /**
   * A assinatura é o que sai no documento, e sem ela a execução não abre
   * (`assertTechnicalResponsible` com `requireSignature`). Avisar aqui é o que
   * separa descobrir agora de descobrir no dia do atendimento.
   */
  it("escolha sem assinatura avisa e bloqueia", () => {
    const semAssinatura = pessoa("sem", "Bruno Lima", false);
    const aviso = avisoDoResponsavelTecnico([semAssinatura], "sem");
    expect(aviso?.bloqueia).toBe(true);
    expect(aviso?.texto).toContain("Bruno Lima");
    expect(aviso?.texto).toContain("assinatura");
  });

  /** O aviso diz onde resolver: a assinatura se cadastra no aplicativo de campo. */
  it("o aviso diz onde cadastrar a assinatura", () => {
    const aviso = avisoDoResponsavelTecnico(
      [pessoa("sem", "Bruno", false)],
      "sem",
    );
    expect(aviso?.texto).toContain("aplicativo de campo");
  });

  it("ninguém habilitado avisa onde habilitar", () => {
    const aviso = avisoDoResponsavelTecnico([], "");
    expect(aviso?.bloqueia).toBe(true);
    expect(aviso?.texto).toContain("Perfil profissional");
  });

  /** Plano sem RT é criável, e trava na execução: o aviso diz as duas coisas. */
  it("sem escolha avisa que nenhuma execução começa", () => {
    const aviso = avisoDoResponsavelTecnico([dono], "");
    expect(aviso?.bloqueia).toBe(true);
    expect(aviso?.texto).toContain("nenhuma execução");
  });

  /** Id que não está na lista não produz frase sobre alguém inexistente. */
  it("escolha fora da lista não inventa aviso", () => {
    expect(avisoDoResponsavelTecnico([dono], "fantasma")).toBeNull();
  });
});
