/**
 * Conta e configurações — a navegação depois da consolidação.
 *
 * O que se prova aqui: que existem dois donos claros e não três portas
 * redundantes; que a rota antiga continua funcionando e cai na seção certa;
 * que cada seção é um endereço; e que consolidar a navegação não misturou
 * domínios — dados pessoais continuam pessoais, e a organização continua da
 * organização, cada um com a sua escrita.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertClean, login, record } from "./support";

/**
 * A aba ativa de uma lista **nomeada**, não qualquer aba ativa da página.
 *
 * A seção de assinatura tem a própria lista de abas. Um seletor global casava
 * com as duas e reprovava por ambiguidade assim que as duas estavam montadas ao
 * mesmo tempo — o que passou a acontecer quando a página encurtou e a segunda
 * lista deixou de chegar depois da asserção.
 */
const CONTA = "Seções da minha conta";
const CONFIGURACOES = "Seções das configurações";

const activeTab = (page: Page, lista: string = CONTA) =>
  page
    .getByRole("tablist", { name: lista })
    .locator('[role="tab"][data-state="active"]');

const path = (page: Page) =>
  page.url().replace(/^https?:\/\/[^/]+/, "");

test.describe("navegação da conta", () => {
  test("a administração tem duas entradas, não três", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/dashboard");

    const nav = page.locator("nav").first();
    await expect(nav.getByRole("link", { name: "Configurações" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Minha conta" })).toBeVisible();
    /** "Organização" deixou de ser uma porta própria: virou seção. */
    await expect(nav.getByRole("link", { name: "Organização" })).toHaveCount(0);

    assertClean(recorder, "navegação");
  });

  test("a rota antiga da organização leva à seção certa, não à primeira aba", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);

    await page.goto("/organizacao");
    await page.waitForURL(/\/configuracoes\?secao=organizacao/, {
      timeout: 20_000,
    });
    await expect(activeTab(page, CONFIGURACOES)).toHaveText("Organização");

    assertClean(recorder, "rota antiga");
  });

  test("cada seção é um endereço", async ({ page }) => {
    const recorder = record(page);
    await login(page);

    /** O laço atravessa as duas telas, e cada uma tem a sua lista de abas. */
    for (const [url, esperado, lista] of [
      ["/configuracoes?secao=seguranca", "Segurança", CONFIGURACOES],
      ["/configuracoes?secao=integracoes", "Integrações", CONFIGURACOES],
      ["/configuracoes?secao=notificacoes", "Notificações", CONFIGURACOES],
      ["/perfil?secao=preferencias", "Preferências", CONTA],
      ["/perfil?secao=contexto", "Contexto", CONTA],
    ] as const) {
      await page.goto(url);
      await expect(activeTab(page, lista)).toHaveText(esperado, {
        timeout: 20_000,
      });
    }

    /** Apelido que não existe mais abre a página, em vez de deixá-la vazia. */
    await page.goto("/configuracoes?secao=aba-que-saiu");
    await expect(activeTab(page, CONFIGURACOES)).toHaveText("Organização");

    assertClean(recorder, "deep links");
  });

  test("trocar de seção muda o endereço, e voltar desfaz", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/perfil");
    await expect(activeTab(page)).toHaveText("Dados pessoais");

    await page.getByRole("tab", { name: "Segurança" }).click();
    await expect(activeTab(page)).toHaveText("Segurança");
    expect(path(page)).toBe("/perfil?secao=seguranca");

    await page.getByRole("tab", { name: "Preferências" }).click();
    await expect(activeTab(page)).toHaveText("Preferências");

    /** Recarregar preserva a seção — o endereço descreve a tela. */
    await page.reload();
    await expect(activeTab(page)).toHaveText("Preferências");

    await page.goBack();
    await expect(activeTab(page)).toHaveText("Segurança");
    await page.goForward();
    await expect(activeTab(page)).toHaveText("Preferências");

    assertClean(recorder, "histórico das seções");
  });

  test("a troca de seção preserva os outros parâmetros da consulta", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);

    await page.goto("/configuracoes?origem=email");
    await page.getByRole("tab", { name: "Segurança" }).click();
    await expect(activeTab(page, CONFIGURACOES)).toHaveText("Segurança");
    expect(path(page)).toContain("origem=email");
    expect(path(page)).toContain("secao=seguranca");

    assertClean(recorder, "parâmetros preservados");
  });
});

test.describe("domínios continuam separados", () => {
  test("o que é da pessoa fica em Minha conta", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/perfil");

    await expect(
      page.getByRole("heading", { name: "Minha conta", level: 1 }),
    ).toBeVisible();
    for (const nome of ["Dados pessoais", "Segurança", "Preferências", "Contexto"]) {
      await expect(page.getByRole("tab", { name: nome })).toBeVisible();
    }

    assertClean(recorder, "minha conta");
  });

  test("o que é da organização fica em Configurações, com escrita própria", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);

    /** Nenhuma escrita de identidade sai daqui — os domínios não se fundiram. */
    const escritas: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "GET") return;
      const p = new URL(request.url()).pathname;
      if (/identity|organization/.test(p)) escritas.push(`${request.method()} ${p}`);
    });

    await page.goto("/configuracoes?secao=organizacao");
    await expect(activeTab(page, CONFIGURACOES)).toHaveText("Organização");
    await expect(
      page.locator('[data-panel="organization-general"]'),
    ).toBeVisible({ timeout: 20_000 });
    /** A Equipe veio da rota antiga; nada se perdeu na consolidação. */
    await expect(page.locator('[data-panel="organization-users"]')).toBeVisible();

    await page.waitForTimeout(1_500);
    expect(escritas, "abrir a seção não escreve nada").toEqual([]);

    assertClean(recorder, "seção organização");
  });

  test("não existe um botão que salve conta e organização juntas", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);

    for (const url of ["/perfil", "/configuracoes?secao=organizacao"]) {
      await page.goto(url);
      await page.waitForTimeout(1_200);
      await expect(
        page.getByRole("button", { name: /salvar tudo|salvar todas/i }),
      ).toHaveCount(0);
    }

    assertClean(recorder, "sem salvar tudo");
  });
});
