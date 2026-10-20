import { describe, expect, it } from "vitest";

import { FINANCIAL_SECTIONS, financialSectionList } from "./sections";
import { resolveSection } from "@/lib/section-navigation";

describe("as seções do Financeiro", () => {
  /**
   * O defeito que este teste tranca.
   *
   * A aba de Recibos foi acrescentada ao JSX e **não** à lista de seções. O apelido
   * não estava registrado, então `resolveSection` caía na primeira seção: a aba
   * aparecia, o endereço mudava para `?secao=recibos` e a seleção voltava para a
   * Visão geral. Visível e inalcançável.
   */
  it("toda seção declarada é alcançável pela URL", () => {
    const lista = financialSectionList({ canQuotes: true });

    for (const apelido of Object.values(FINANCIAL_SECTIONS)) {
      expect(
        resolveSection(apelido, lista),
        `${apelido} precisa estar na lista para a aba abrir`,
      ).toBe(apelido);
    }
  });

  it("a visão geral é a primeira, porque é o destino de quem não pede seção", () => {
    expect(financialSectionList({ canQuotes: true })[0]).toBe(
      FINANCIAL_SECTIONS.overview,
    );
  });

  it("sem a capability de orçamento, a seção some da lista", () => {
    /* Some, e não abre para dar erro: o plano que não tem proposta não tem a aba. */
    const lista = financialSectionList({ canQuotes: false });

    expect(lista).not.toContain(FINANCIAL_SECTIONS.quotes);

    /* E o endereço guardado cai na primeira, em vez de abrir uma aba inexistente. */
    expect(resolveSection(FINANCIAL_SECTIONS.quotes, lista)).toBe(
      FINANCIAL_SECTIONS.overview,
    );
  });

  it("recibos vem logo depois de orçamentos", () => {
    /* A ordem conta uma história: a proposta é a receita que ainda vai existir, o
       recibo é a que já entrou. Lançamentos vêm depois, porque é onde as duas
       aparecem somadas. */
    const lista = financialSectionList({ canQuotes: true });

    expect(lista.indexOf(FINANCIAL_SECTIONS.receipts)).toBe(
      lista.indexOf(FINANCIAL_SECTIONS.quotes) + 1,
    );
  });
});
