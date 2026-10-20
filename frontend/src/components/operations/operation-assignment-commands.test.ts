import { describe, expect, it } from "vitest";

import {
  comandosDeAtribuicao,
  type AtribuicaoDaOperacao,
} from "./operation-assignment-commands";

const vazio: AtribuicaoDaOperacao = { responsavel: "", auxiliares: [] };

describe("os comandos de atribuição na edição", () => {
  /**
   * O defeito relatado.
   *
   * Editar uma operação e escolher um técnico mandava o campo no `PATCH`, que recusa
   * mudar técnicos — 400 e "Revise os campos informados", sempre.
   */
  it("escolher um responsável numa operação sem dono emite o comando dele", () => {
    expect(
      comandosDeAtribuicao(vazio, { responsavel: "tec", auxiliares: [] }),
    ).toEqual([{ tipo: "responsavel", userId: "tec" }]);
  });

  it("trocar o responsável emite um comando só", () => {
    expect(
      comandosDeAtribuicao(
        { responsavel: "antigo", auxiliares: [] },
        { responsavel: "novo", auxiliares: [] },
      ),
    ).toEqual([{ tipo: "responsavel", userId: "novo" }]);
  });

  /**
   * Nada mudou, nada é chamado.
   *
   * Sem esta comparação, abrir e salvar sem tocar na equipe reemitiria a atribuição
   * e gravaria histórico de uma troca que não houve.
   */
  it("sem mudança, não emite comando", () => {
    const atual = { responsavel: "tec", auxiliares: ["a", "b"] };
    expect(comandosDeAtribuicao(atual, { ...atual })).toEqual([]);
  });

  it("a ordem dos auxiliares não conta como mudança", () => {
    expect(
      comandosDeAtribuicao(
        { responsavel: "tec", auxiliares: ["a", "b"] },
        { responsavel: "tec", auxiliares: ["b", "a"] },
      ),
    ).toEqual([]);
  });

  describe("auxiliares", () => {
    it("adicionar emite um comando por pessoa", () => {
      expect(
        comandosDeAtribuicao(
          { responsavel: "tec", auxiliares: [] },
          { responsavel: "tec", auxiliares: ["a", "b"] },
        ),
      ).toEqual([
        { tipo: "adicionar-auxiliar", userId: "a" },
        { tipo: "adicionar-auxiliar", userId: "b" },
      ]);
    });

    it("remover emite um comando por pessoa", () => {
      expect(
        comandosDeAtribuicao(
          { responsavel: "tec", auxiliares: ["a", "b"] },
          { responsavel: "tec", auxiliares: ["a"] },
        ),
      ).toEqual([{ tipo: "remover-auxiliar", userId: "b" }]);
    });

    it("troca de auxiliar remove antes de adicionar", () => {
      expect(
        comandosDeAtribuicao(
          { responsavel: "tec", auxiliares: ["sai"] },
          { responsavel: "tec", auxiliares: ["entra"] },
        ),
      ).toEqual([
        { tipo: "remover-auxiliar", userId: "sai" },
        { tipo: "adicionar-auxiliar", userId: "entra" },
      ]);
    });
  });

  describe("a promoção", () => {
    /**
     * Promover um auxiliar é **um** comando.
     *
     * O servidor o retira dos auxiliares na mesma transação. Emitir também o
     * `DELETE` dele removeria quem acabou de ser promovido, dependendo de qual
     * chegasse primeiro.
     */
    it("promover um auxiliar não emite a remoção dele", () => {
      expect(
        comandosDeAtribuicao(
          { responsavel: "antigo", auxiliares: ["sobe"] },
          { responsavel: "sobe", auxiliares: [] },
        ),
      ).toEqual([{ tipo: "responsavel", userId: "sobe" }]);
    });

    /** O responsável que saiu pode virar auxiliar, e aí a adição é dele. */
    it("o responsável anterior pode descer para auxiliar", () => {
      expect(
        comandosDeAtribuicao(
          { responsavel: "antigo", auxiliares: ["sobe"] },
          { responsavel: "sobe", auxiliares: ["antigo"] },
        ),
      ).toEqual([
        { tipo: "responsavel", userId: "sobe" },
        { tipo: "adicionar-auxiliar", userId: "antigo" },
      ]);
    });

    /** Ninguém é as duas coisas: o servidor recusa, e isto não tenta. */
    it("não adiciona como auxiliar quem é o responsável", () => {
      expect(
        comandosDeAtribuicao(vazio, {
          responsavel: "tec",
          auxiliares: ["tec"],
        }),
      ).toEqual([{ tipo: "responsavel", userId: "tec" }]);
    });
  });

  describe("o que a API não expressa", () => {
    /**
     * Limpar o responsável não emite nada.
     *
     * O comando exige um `userId`: não há "desatribuir". Esvaziar o campo não pode
     * virar uma chamada inventada — e a tela avisa, em vez de prometer calada.
     */
    it("esvaziar o responsável não emite comando", () => {
      expect(
        comandosDeAtribuicao(
          { responsavel: "tec", auxiliares: [] },
          { responsavel: "", auxiliares: [] },
        ),
      ).toEqual([]);
    });

    /** Mas os auxiliares continuam sendo mexidos no mesmo salvamento. */
    it("esvaziar o responsável não impede mexer nos auxiliares", () => {
      expect(
        comandosDeAtribuicao(
          { responsavel: "tec", auxiliares: ["a"] },
          { responsavel: "", auxiliares: ["b"] },
        ),
      ).toEqual([
        { tipo: "remover-auxiliar", userId: "a" },
        { tipo: "adicionar-auxiliar", userId: "b" },
      ]);
    });
  });
});
