/**
 * Planos públicos — a vitrine comercial, sem sessão.
 *
 * ## O que só o navegador prova
 *
 * Que a página **abre sem login**. Esse é o ponto: quem chega de um anúncio
 * não tem conta, e uma página de preços atrás de autenticação é uma página de
 * preços que ninguém lê. Um teste de unidade não distingue "renderiza" de
 * "renderiza para quem já entrou".
 *
 * Prova também que os valores vêm do catálogo do servidor, que a avaliação
 * gratuita só é anunciada onde existe, e que nenhum código interno de plano
 * escapa para a tela.
 */
import { expect, test } from "@playwright/test";

import { assertClean, record, settled } from "./support";

/** As larguras do gate. */
const LARGURAS = [
  { nome: "1440", width: 1440, height: 900 },
  { nome: "1024", width: 1024, height: 800 },
  { nome: "768", width: 768, height: 900 },
  { nome: "375", width: 375, height: 812 },
] as const;

/** Espaço não separável — o `pt-BR` usa isso entre o símbolo e o número. */
const semNbsp = (texto: string) => texto.replace(/ /g, " ");

test.describe("Planos públicos", () => {
  test("a landing tem uma seção de Planos com os quatro planos", async ({
    page,
  }) => {
    const recorder = record(page);
    await page.goto("/");
    await settled(page);

    await expect(
      page.getByRole("heading", { name: "Planos", exact: true }),
    ).toBeVisible();

    for (const plano of [
      "Essencial",
      "Profissional",
      "Profissional + Inteligência",
      "Empresarial Ilimitado",
    ]) {
      await expect(
        page.getByRole("article", { name: plano, exact: true }),
      ).toBeVisible();
    }

    /** E o caminho para a comparação completa. */
    await expect(
      page.getByRole("link", { name: "Ver todos os planos" }),
    ).toBeVisible();

    assertClean(recorder, "landing");
  });

  test("a página detalhada abre sem sessão", async ({ page }) => {
    /**
     * Sem `login()`, de propósito. Se a rota exigisse sessão, o middleware
     * redirecionaria para `/login` e o título abaixo não existiria.
     */
    const recorder = record(page);
    await page.goto("/planos");
    await settled(page);

    await expect(page).toHaveURL(/\/planos$/);
    await expect(
      page.getByRole("heading", {
        name: "Planos para cada tamanho de operação",
      }),
    ).toBeVisible();

    assertClean(recorder, "planos");
  });

  test("os preços são os do catálogo, nas três periodicidades", async ({
    page,
  }) => {
    await page.goto("/planos");
    await settled(page);

    const essencial = page.getByRole("article", {
      name: "Essencial",
      exact: true,
    });

    /** Mensal é a referência inicial. */
    await expect(essencial).toContainText("59,90");

    await page.getByRole("tab", { name: "Semestral" }).click();
    await expect(essencial).toContainText("329,40");

    await page.getByRole("tab", { name: "Anual" }).click();
    await expect(essencial).toContainText("599,00");

    /** O equivalente mensal aparece ao lado do total, e não no lugar dele. */
    const texto = semNbsp((await essencial.textContent()) ?? "");
    expect(texto).toContain("por mês");
  });

  test("a avaliação gratuita é anunciada só no Essencial", async ({ page }) => {
    await page.goto("/planos");
    await settled(page);

    await expect(
      page
        .getByRole("article", { name: "Essencial", exact: true })
        .getByText(/30 dias grátis/),
    ).toBeVisible();

    for (const plano of [
      "Profissional",
      "Profissional + Inteligência",
      "Empresarial Ilimitado",
    ]) {
      await expect(
        page
          .getByRole("article", { name: plano, exact: true })
          .getByText(/dias grátis/),
      ).toHaveCount(0);
    }
  });

  test("a inteligência separa os planos, e o ilimitado é palavra", async ({
    page,
  }) => {
    await page.goto("/planos");
    await settled(page);

    /** Dois planos, e só dois, carregam o selo. */
    await expect(page.getByText("Inteligência", { exact: true })).toHaveCount(2);

    /** Sem teto é "Ilimitado", nunca `null`, `-1` ou número mágico. */
    await expect(page.getByText("Ilimitado").first()).toBeVisible();
  });

  test("nenhum código interno de plano aparece", async ({ page }) => {
    await page.goto("/planos");
    await settled(page);

    /**
     * `innerText`, não `textContent`.
     *
     * `textContent` inclui o conteúdo dos `<script>` — e o payload do React
     * Server Components carrega o catálogo inteiro, `code` incluído, porque é
     * assim que o servidor entrega os dados ao cliente. O que se cobra aqui é
     * o que a **pessoa lê**, e é isso que `innerText` devolve.
     */
    const corpo = await page.locator("body").innerText();
    for (const codigo of [
      "ESSENTIAL",
      "PROFESSIONAL_INTELLIGENCE",
      "ENTERPRISE_UNLIMITED",
      "planKey",
      "ORBIT_INTELLIGENCE",
      "SERVICE_ORDERS_CREATED",
    ]) {
      expect(corpo).not.toContain(codigo);
    }
  });

  test("nenhum limite de armazenamento é publicado", async ({ page }) => {
    await page.goto("/planos");
    await settled(page);

    const corpo = await page.locator("body").innerText();
    expect(corpo).not.toMatch(/armazenamento|storage|\bGB\b|\bTB\b/i);
  });

  test("o CTA leva ao cadastro, e não a um checkout", async ({ page }) => {
    await page.goto("/planos");
    await settled(page);

    const cta = page
      .getByRole("article", { name: "Essencial", exact: true })
      .getByRole("link", { name: "Testar grátis" });
    await expect(cta).toHaveAttribute("href", /^\/cadastro/);

    await cta.click();
    await expect(page).toHaveURL(/\/cadastro/);
  });

  for (const largura of LARGURAS) {
    test(`a página cabe em ${largura.nome}`, async ({ page }) => {
      await page.setViewportSize({
        width: largura.width,
        height: largura.height,
      });
      await page.goto("/planos");
      await settled(page);

      /**
       * A pergunta é comportamental: a **página** rola de lado?
       *
       * Comparar `documentElement.scrollWidth` com a largura da janela não
       * responde isso — o Chromium contabiliza ali o conteúdo de contêineres
       * que rolam internamente, e a tabela de comparação é justamente um
       * deles. Tentar rolar e ver se a janela se move responde.
       */
      await page.evaluate(() => window.scrollTo(500, 0));
      expect(await page.evaluate(() => window.scrollX)).toBe(0);

      /** E nada transborda o corpo da página. */
      const estoura = await page.evaluate(
        () => document.body.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(estoura).toBe(false);
    });
  }
});
