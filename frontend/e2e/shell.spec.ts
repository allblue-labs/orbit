/**
 * O shell — o que a navegação principal mostra e promete.
 *
 * O que se prova aqui: que a sidebar oferece navegação, contexto e conta, e
 * nada além disso; que o contexto exibido é o da sessão e não um nome de
 * exemplo; e que a navegação consolidada pelas etapas anteriores continua de pé.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertClean, login, record } from "./support";

const aside = (page: Page) => page.locator("aside");
const nav = (page: Page) =>
  page.locator('nav[aria-label="Navegação principal"]');

async function expand(page: Page) {
  const toggle = page.getByRole("button", { name: "Expandir menu lateral" });
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Recolher menu lateral" }),
  ).toBeVisible();
}

test.describe("shell", () => {
  test("a sidebar expandida não promove funcionalidade", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/dashboard");
    await expand(page);

    /**
     * O card dizia "Orbit Copilot — Automatize rotinas operacionais" com um
     * botão "Ativar" sem `onClick`, promovendo o que o produto não tem: não
     * existe "copilot" em backend, contrato, rota ou capability.
     */
    await expect(aside(page)).not.toContainText(/copilot/i);
    await expect(aside(page).getByRole("button", { name: "Ativar" })).toHaveCount(0);

    /** E nenhum bloco vazio ficou no lugar dele. */
    const vazios = await aside(page).evaluate((el) =>
      Array.from(el.children).filter(
        (c) =>
          !(c.textContent ?? "").trim() &&
          !c.querySelector("img,svg") &&
          c.getBoundingClientRect().height > 8,
      ).length,
    );
    expect(vazios).toBe(0);

    assertClean(recorder, "sidebar expandida");
  });

  test("o contexto mostra a organização da sessão, não um exemplo", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/dashboard");
    await expand(page);

    /** Havia "Acme Industries — Workspace produção", inventados, num botão inerte. */
    await expect(aside(page)).not.toContainText("Acme Industries");
    await expect(aside(page)).not.toContainText("Workspace produção");

    const contexto = aside(page).locator('a[href*="secao=contexto"]');
    await expect(contexto).toBeVisible();
    /** Leva para onde a unidade de fato se troca. */
    await contexto.click();
    await page.waitForURL(/\/perfil\?secao=contexto/, { timeout: 20_000 });
    await expect(page.locator('[role="tab"][data-state="active"]')).toHaveText(
      "Contexto",
    );

    assertClean(recorder, "contexto da sessão");
  });

  test("a navegação consolidada das etapas anteriores continua de pé", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/dashboard");
    await expand(page);

    const menu = nav(page);
    /**
     * PR-FX-01: "Execuções de artefato" saiu do menu — era o nome do modelo,
     * não o do trabalho. O documento continua alcançável em "Documentos" e
     * dentro da OS, do PMOC e da visita técnica.
     */
    await expect(
      menu.getByRole("link", { name: "Execuções de artefato" }),
    ).toHaveCount(0);
    await expect(menu.getByRole("link", { name: "Documentos" })).toBeVisible();
    /** H05: duas entradas de administração, e "Organização" não é uma delas. */
    await expect(menu.getByRole("link", { name: "Configurações" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Minha conta" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Organização" })).toHaveCount(0);
    /** H03: Clientes segue no lugar. */
    await expect(menu.getByRole("link", { name: "Clientes" })).toBeVisible();

    assertClean(recorder, "navegação preservada");
  });

  test("o item ativo é anunciado, não só pintado", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/clientes");
    await expand(page);

    const ativo = nav(page).locator('a[aria-current="page"]');
    await expect(ativo).toHaveCount(1);
    await expect(ativo).toHaveAttribute("aria-label", "Clientes");

    assertClean(recorder, "item ativo");
  });

  test("recolhida, cada item continua tendo nome", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/dashboard");

    /** A sidebar abre recolhida: só ícones, e o nome vem do rótulo acessível. */
    const links = nav(page).getByRole("link");
    await expect(links.first()).toBeAttached({ timeout: 20_000 });
    const total = await links.count();
    expect(total).toBeGreaterThan(10);
    for (let i = 0; i < total; i++) {
      await expect(links.nth(i)).toHaveAttribute("aria-label", /\S/);
    }

    await expect(
      page.getByRole("button", { name: "Expandir menu lateral" }),
    ).toBeVisible();

    assertClean(recorder, "sidebar recolhida");
  });

  test("a navegação é um marco de página e rola dentro de si", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/dashboard");
    await expand(page);

    await expect(nav(page)).toHaveAttribute("aria-label", "Navegação principal");
    /** O menu longo rola no próprio painel; a página não ganha barra horizontal. */
    const sideways = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(sideways).toBe(0);

    assertClean(recorder, "marco de navegação");
  });
});

/* ------------------------------------------------------------------ */
/* Navegação em telas estreitas                                        */
/* ------------------------------------------------------------------ */

test.describe("navegação abaixo do desktop", () => {
  for (const width of [768, 375]) {
    test(`a ${width}px o menu abre, navega e devolve o foco`, async ({ page }) => {
      const recorder = record(page);
      await login(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/dashboard");

      /** A barra fixa não existe aqui; o gatilho é o botão do cabeçalho. */
      await expect(page.locator("aside")).toBeHidden();
      const trigger = page.getByRole("button", { name: "Abrir menu" });
      await expect(trigger).toBeVisible();

      await trigger.click();
      const drawer = page.getByRole("dialog");
      await expect(drawer).toBeVisible();

      /** A mesma lista do menu fixo — não uma segunda navegação escrita à mão. */
      const links = drawer.getByRole("link");
      /* 17 desde que a Central de Catálogos entrou em Administração. */
      await expect(links).toHaveCount(17);
      await expect(
        drawer.getByRole("link", { name: "Execuções de artefato" }),
      ).toHaveCount(0);

      /**
       * Notificações não está aqui — nem no menu fixo.
       *
       * Ela vive no sino da topbar: é coisa que se consulta de passagem, não um
       * destino que se escolhe. A rota continua existindo, e "Ver todas" leva a
       * ela.
       */
      await expect(
        drawer.getByRole("link", { name: "Notificações" }),
      ).toHaveCount(0);
      await expect(drawer.getByRole("link", { name: "Minha conta" })).toBeVisible();
      await expect(drawer.getByRole("link", { name: "Organização" })).toHaveCount(0);
      await expect(drawer).not.toContainText(/copilot/i);

      /** Cabe na tela e rola por dentro quando os itens não cabem. */
      const box = (await drawer.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(width);
      expect(
        await drawer.getByRole("navigation").evaluate((n) => n.scrollHeight > n.clientHeight),
      ).toBe(true);

      /** O foco entra na gaveta. */
      expect(
        await page.evaluate(() =>
          document.querySelector('[role="dialog"]')?.contains(document.activeElement),
        ),
      ).toBe(true);

      /** Escape fecha e devolve o foco a quem abriu. */
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);

      /** Escolher um destino navega e fecha. */
      await trigger.click();
      await page.getByRole("dialog").getByRole("link", { name: "Clientes" }).click();
      await page.waitForURL(/\/clientes/, { timeout: 20_000 });
      await expect(page.getByRole("dialog")).toBeHidden();

      /** E o item ativo continua sendo anunciado. */
      await trigger.click();
      const ativo = page.getByRole("dialog").locator('a[aria-current="page"]');
      await expect(ativo).toHaveCount(1);
      await expect(ativo).toHaveAttribute("aria-label", "Clientes");
      await page.keyboard.press("Escape");

      /** A página não ganha barra horizontal por causa da gaveta. */
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBe(0);

      assertClean(recorder, `navegação a ${width}px`);
    });
  }

  test("o contexto da sessão aparece também na gaveta", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto("/dashboard");

    await page.getByRole("button", { name: "Abrir menu" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).not.toContainText("Acme Industries");
    await expect(drawer.locator('a[href*="secao=contexto"]')).toBeVisible();

    assertClean(recorder, "contexto na gaveta");
  });
});
