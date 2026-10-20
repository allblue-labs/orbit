/**
 * Alinhamento da central de documentos.
 *
 * A busca dividia a linha com o resumo de resultados: parava ~120px antes da
 * borda enquanto as filas, o cartão de estado vazio e a paginação iam até o fim
 * da página. O olho lê isso como um campo torto, não como duas colunas.
 *
 * Hoje a busca é uma célula da faixa de filtros, como nos outros Workspaces, e
 * quem tem de acompanhar a lista é a faixa. A central virou aba de Relatórios, e o
 * alinhamento tem de sobreviver a isso: dentro da aba o contêiner é o da página de
 * fora, e um segundo contêiner aqui estreitaria a lista sem estreitar os filtros. A medida é a borda direita de cada
 * bloco, no navegador real. Um teste visual aprovaria qualquer largura; este
 * reprova quando elas voltam a divergir.
 */
import { expect, test } from "@playwright/test";

import { login, settled } from "./support";

for (const largura of [1440, 1024]) {
  test(`a ${largura}px os filtros acompanham a largura da lista`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: largura, height: 900 });
    await login(page);
    /* O endereço canônico: os documentos emitidos viraram aba de Relatórios.
       `/documentos` ainda leva até aqui, e quem prova o redirecionamento é o
       teste de estrutura do menu — depender dele aqui faria este teste de
       alinhamento falhar por um motivo que não é o dele. */
    await page.goto("/relatorios?secao=emitidos");
    await settled(page);

    const bordas = await page.evaluate(() => {
      const direita = (seletor: string) => {
        const elemento = document.querySelector(seletor);
        return elemento
          ? Math.round(elemento.getBoundingClientRect().right)
          : null;
      };
      return {
        filtros: direita('[data-testid="documents-filters"]'),
        /** Existe tanto com filas preenchidas quanto no primeiro deploy vazio. */
        conteudo: direita('[data-testid="documents-results"]'),
        /** A busca continua dentro da faixa, nunca além dela. */
        busca: direita("#documents-search"),
      };
    });

    expect(bordas.filtros, "a faixa de filtros precisa existir").not.toBeNull();
    expect(bordas.conteudo, "a lista precisa existir").not.toBeNull();
    expect(bordas.busca, "a busca precisa existir").not.toBeNull();

    /** Um pixel de folga para arredondamento de subpixel. */
    expect(Math.abs(bordas.filtros! - bordas.conteudo!)).toBeLessThanOrEqual(1);
    expect(bordas.busca!).toBeLessThanOrEqual(bordas.filtros! + 1);
  });
}
