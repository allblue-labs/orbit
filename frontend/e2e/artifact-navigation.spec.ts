/**
 * Execuções de artefato saíram do menu.
 *
 * ## O que se cobra
 *
 * Que o conceito de arquitetura deixou de ser área de produto — e que **nada
 * mais** foi levado junto. O documento continua alcançável de onde a pessoa o
 * procura: dentro da ordem de serviço, do PMOC, da visita técnica e no Centro
 * de Documentos.
 *
 * O deep link por execução continua vivo: ele é usado a partir do cliente e da
 * equipe, e apagá-lo quebraria navegação legítima.
 */
import { expect, test } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

test.describe("Navegação de artefatos", () => {
  test("o menu não oferece Execuções de artefato", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/dashboard");
    await settled(page);

    const menu = page.getByRole("navigation").first();
    await expect(
      menu.getByRole("link", { name: /Execuç(ões|ão) de artefato/ }),
    ).toHaveCount(0);

    /**
     * E os destinos vizinhos continuam de pé, sem buraco no menu.
     *
     * "Documentos" saiu desta lista junto com o grupo dele: os documentos
     * emitidos passaram a ser aba de Relatórios, que é o vizinho que restou.
     */
    for (const item of ["Visão geral", "Relatórios"]) {
      await expect(menu.getByRole("link", { name: item })).toBeVisible();
    }

    assertClean(recorder, "menu");
  });

  test("a rota global leva ao Centro de Documentos", async ({ page }) => {
    await login(page);
    await page.goto("/execucoes");
    await settled(page);

    /**
     * Redireciona em vez de 404: o caminho continua alcançável por favorito e
     * histórico, e o que a pessoa procurava existe com outro nome — hoje a aba
     * Documentos emitidos, dentro de Relatórios.
     */
    await expect(page).toHaveURL(/\/relatorios\?secao=emitidos$/);

    /** E a aba certa está selecionada, não a primeira da lista. */
    await expect(
      page.getByRole("tab", { name: "Documentos emitidos", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("o deep link por execução continua funcionando", async ({ page }) => {
    await login(page);
    await page.goto("/documentos");
    await settled(page);

    /**
     * A partir do Centro de Documentos chega-se a uma execução. Se não houver
     * documento nenhum no ambiente, o teste se declara ausente em vez de
     * inventar um id — um id fabricado provaria só que a rota devolve 404.
     */
    const link = page.locator('a[href^="/execucoes/"]').first();
    if ((await link.count()) === 0) {
      test.skip(true, "sem documentos emitidos neste ambiente");
      return;
    }

    await link.click();
    await settled(page);
    await expect(page).toHaveURL(/\/execucoes\/[0-9a-f-]+$/);

    /** A tela abre de verdade, e não numa rota morta. */
    await expect(page.getByRole("main")).toBeVisible();
  });

  test("o Centro de Documentos continua de pé", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/documentos");
    await settled(page);

    await expect(page.getByRole("main")).toBeVisible();
    assertClean(recorder, "documentos");
  });

  test("Modelos de documento continuam em Configurações", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/artefatos");
    await settled(page);

    await expect(page.getByRole("main")).toBeVisible();
    assertClean(recorder, "modelos");
  });

  test("o plano legado saiu da aba Organização", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/configuracoes?secao=organizacao");
    await settled(page);

    /**
     * Havia dois painéis de plano — este e o da aba Assinatura. Ficou um, e
     * esta aba aponta para ele.
     */
    await expect(
      page.getByRole("heading", { name: "Plano", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Plano e assinatura" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Abrir Plano e assinatura" }),
    ).toBeVisible();

    /** E nenhum código interno de plano aparece. */
    const corpo = await page.locator("body").innerText();
    expect(corpo).not.toMatch(
      /ESSENTIAL|PROFESSIONAL_INTELLIGENCE|ENTERPRISE_UNLIMITED/,
    );

    assertClean(recorder, "organizacao");
  });
});
