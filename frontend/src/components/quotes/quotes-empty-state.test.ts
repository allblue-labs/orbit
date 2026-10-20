import { describe, expect, it } from "vitest";

import { quotesEmptyCopy } from "./quotes-empty-state";
import { QUOTE_STATUS_LABELS } from "@/types/quotes";
import type { QuoteStatus } from "@/types/quotes";

const base = {
  emptyTitle: "Nenhuma proposta",
  emptyDescription: "Crie um orçamento para um cliente.",
};

describe("o vazio da lista de propostas", () => {
  it("sem recorte, é o texto de quem chama e oferece criar", () => {
    const copy = quotesEmptyCopy({ ...base, isFiltered: false });
    expect(copy.title).toBe("Nenhuma proposta");
    expect(copy.description).toBe("Crie um orçamento para um cliente.");
    expect(copy.offersCreate).toBe(true);
  });

  /**
   * A situação fixa não muda o vazio de uma carteira realmente vazia.
   *
   * Quem embute a lista já recortada passa `status` sem que `isFiltered` seja
   * verdadeiro: não houve escolha de ninguém na tela.
   */
  it("sem recorte, a situação de quem embute não inventa frase", () => {
    const copy = quotesEmptyCopy({
      ...base,
      isFiltered: false,
      status: "APPROVED",
    });
    expect(copy.title).toBe("Nenhuma proposta");
  });

  /**
   * O defeito que isto tranca.
   *
   * Com um texto fixo, quem tem trinta propostas e filtrou pelas aprovadas lia
   * "nenhuma proposta — crie um orçamento": a tela negava o que ela mesma tinha
   * acabado de mostrar, e oferecia criar como saída para um filtro.
   */
  it("com situação escolhida, nomeia a situação e não oferece criar", () => {
    const copy = quotesEmptyCopy({
      ...base,
      isFiltered: true,
      status: "APPROVED",
    });
    expect(copy.title).toBe("Nenhum orçamento aprovado");
    expect(copy.offersCreate).toBe(false);
  });

  /** O que a aba ensinava, no lugar onde a pergunta foi feita. */
  it("explica o que a situação significa", () => {
    const copy = quotesEmptyCopy({
      ...base,
      isFiltered: true,
      status: "SENT",
    });
    expect(copy.description).toContain("aguardando decisão");
  });

  it("sem situação, nomeia o recorte sem adivinhar qual é", () => {
    const copy = quotesEmptyCopy({ ...base, isFiltered: true });
    expect(copy.title).toBe("Nenhum orçamento com esses filtros");
    expect(copy.description).toBe("Ajuste a busca ou os filtros.");
    expect(copy.offersCreate).toBe(false);
  });

  /**
   * Concordância, para todas as seis.
   *
   * Os rótulos de situação são masculinos (`Aprovado`, `Enviado`), e a frase
   * natural seria "nenhuma **proposta** aprovado". O teste varre o catálogo
   * inteiro em vez de um exemplo: a próxima situação que o contrato publicar
   * entra aqui sem ninguém lembrar de conferir o idioma.
   */
  it.each([
    "DRAFT",
    "SENT",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    "CANCELLED",
  ] as QuoteStatus[])("a frase de %s concorda em gênero", (status) => {
    const copy = quotesEmptyCopy({ ...base, isFiltered: true, status });
    expect(copy.title).toBe(
      `Nenhum orçamento ${QUOTE_STATUS_LABELS[status].toLocaleLowerCase("pt-BR")}`,
    );
    /// Nenhuma frase termina em "a": o substantivo é masculino.
    expect(copy.title).not.toMatch(/\bproposta\b/);
    expect(copy.title.endsWith("o") || copy.title.endsWith("ão")).toBe(true);
  });

  /** Situação desconhecida não produz frase pela metade com espaço sobrando. */
  it("situação fora do catálogo não deixa a frase pendurada", () => {
    const copy = quotesEmptyCopy({
      ...base,
      isFiltered: true,
      status: "INVENTADO" as QuoteStatus,
    });
    expect(copy.title).toBe("Nenhum orçamento");
    expect(copy.description).toBe("Ajuste a busca ou os filtros.");
  });
});
