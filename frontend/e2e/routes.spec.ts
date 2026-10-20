/**
 * As rotas principais, em navegador real, nos três viewports que importam.
 *
 * O gate é o mesmo para todas: renderizar sem exceção, sem `console.error`,
 * sem aviso de hydration — e sem que o shell vaze horizontalmente quando a
 * janela encolhe para tablet.
 */
import { expect, test } from "@playwright/test";
import { assertClean, login, record, settled } from "./support";

const ROUTES = [
  "/dashboard",
  "/operacoes",
  "/agenda",
  "/clientes",
  "/ativos",
  "/catalogo",
  /* Redirecionam para abas, e entram aqui de propósito: link guardado tem de
     chegar a algum lugar sem exceção e sem aviso de hydration. */
  "/orcamentos",
  "/financeiro",
  "/documentos",
  "/artefatos",
  "/execucoes",
  "/relatorios",
  "/equipe",
  "/organizacao",
  "/configuracoes",
  "/notificacoes",
  "/perfil",
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "tablet-portrait", width: 768, height: 1024 },
];

test.describe("rotas principais", () => {
  for (const viewport of VIEWPORTS) {
    /**
     * Dezessete rotas, uma navegação de cada vez, contra a aplicação real.
     * O orçamento padrão de 60 s é para um teste, não para uma varredura.
     */
    test.setTimeout(240_000);

    test(`${viewport.name} (${viewport.width}px) renderiza sem erro e sem vazamento horizontal`, async ({
      page,
    }) => {
      const recorder = record(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await login(page);

      const overflowing: string[] = [];

      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await settled(page);

        /**
         * O shell montou e a rota tem conteúdo.
         *
         * `body` visível não prova nada: ele existe até na página em branco
         * entre navegações. A navegação principal e um volume mínimo de texto,
         * sim — juntos, dizem que o layout montou e a rota não caiu no
         * boundary de erro. O shell é renderizado no cliente atrás do
         * `SessionGate`, então a espera é explícita, não instantânea.
         */
        await page.waitForSelector("nav", { state: "attached", timeout: 20_000 });
        const rendered = await page.evaluate(
          () => (document.body.innerText ?? "").trim().length,
        );
        expect(rendered, `conteúdo renderizado em ${route}`).toBeGreaterThan(50);

        /**
         * Vazamento horizontal.
         *
         * Uma tabela larga pode rolar **dentro** do próprio container; o que
         * não pode é empurrar o documento. A diferença é exatamente esta
         * medida.
         */
        const overflow = await page.evaluate(() => {
          const el = document.documentElement;
          return el.scrollWidth - el.clientWidth;
        });
        if (overflow > 1) overflowing.push(`${route} (+${overflow}px)`);
      }

      expect(overflowing, `rotas com scroll horizontal em ${viewport.name}`).toEqual([]);
      assertClean(recorder, `${viewport.name}`);
    });
  }
});

test("rota inexistente mostra o 404 do produto", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/rota-que-nao-existe");
  await settled(page);

  await expect(page.getByText(/não encontrad|404/i).first()).toBeVisible();

  /**
   * O 404 é a resposta certa, e o navegador registra o status como erro de
   * recurso. Isso não é defeito de runtime — o que precisa estar limpo é o
   * resto: nenhuma exceção, nenhum aviso de React, nenhuma requisição de
   * dados falhando por trás da página de ausência.
   */
  expect(recorder.pageErrors, "exceções na página 404").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React na 404").toEqual([]);
  expect(
    recorder.consoleErrors.filter(
      (message) => !/status of 404/i.test(message),
    ),
    "console.error além do próprio 404",
  ).toEqual([]);
});
