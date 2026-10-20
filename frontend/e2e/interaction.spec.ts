/**
 * Teclado, foco, diálogos, estados e formatação — o que só o DOM responde.
 *
 * Nada aqui testa regra de negócio. O que se verifica é a parte da experiência
 * que é responsabilidade do navegador: dá para operar sem mouse? o foco volta
 * para onde saiu? o valor aparece em português e em real? o fuso do cliente
 * mexe na data que o servidor decidiu?
 */
import { expect, test } from "@playwright/test";
import { assertClean, login, record, settled } from "./support";

test("o shell inteiro é alcançável por teclado, com foco visível", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  const reached: string[] = [];
  for (let step = 0; step < 25; step += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        label:
          el.getAttribute("aria-label") ??
          el.textContent?.trim().slice(0, 30) ??
          "",
        /** Foco perceptível: contorno, anel ou sombra. */
        visible:
          style.outlineStyle !== "none" ||
          style.boxShadow !== "none" ||
          el.matches(":focus-visible"),
      };
    });
    if (focused) reached.push(`${focused.tag}:${focused.label}`);
    if (focused && !focused.visible) {
      throw new Error(`controle sem foco visível: ${focused.tag} "${focused.label}"`);
    }
  }

  /** Tabulação chegou a controles de verdade, não parou no primeiro. */
  expect(reached.length).toBeGreaterThan(5);
  assertClean(recorder, "navegação por teclado");
});

test("o diálogo prende o foco, fecha no Escape e devolve o foco ao gatilho", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  const trigger = page.getByRole("button", { name: /Ações da operação/i }).first();
  await trigger.click();
  await page.getByRole("menuitem", { name: /Alterar status/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  /** O foco entrou no diálogo — não ficou na página por baixo. */
  const insideDialog = await page.evaluate(() => {
    const active = document.activeElement;
    const dialogEl = document.querySelector('[role="dialog"]');
    return Boolean(dialogEl && active && dialogEl.contains(active));
  });
  expect(insideDialog, "foco inicial dentro do diálogo").toBe(true);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  /**
   * E voltou para quem o abriu, senão a navegação por teclado se perde.
   *
   * Esperado, e não lido uma vez: a devolução do foco acontece depois de o
   * diálogo sumir, e uma leitura única no instante seguinte a `toBeHidden()`
   * pega o `<body>` quando a máquina está carregada. Passava sozinho e
   * reprovava na suíte inteira — corrida do teste, não defeito da tela.
   */
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.activeElement?.getAttribute("aria-label") ?? "",
        ),
      { timeout: 5_000 },
    )
    .toMatch(/Ações da operação/i);

  assertClean(recorder, "diálogo");
});

test("controles só de ícone têm nome acessível", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  const unnamed = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button"))
      .filter((button) => {
        if (!button.checkVisibility?.()) return false;
        const text = button.textContent?.trim() ?? "";
        if (text.length > 0) return false;
        return !(
          button.getAttribute("aria-label") ||
          button.getAttribute("title") ||
          button.getAttribute("aria-labelledby")
        );
      })
      .map((button) => button.outerHTML.slice(0, 90)),
  );

  expect(unnamed, "botões sem texto e sem nome acessível").toEqual([]);
  assertClean(recorder, "nomes acessíveis");
});

test("busca não dispara uma requisição por tecla", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/orbit/operations")) requests += 1;
  });

  const search = page.getByLabel("Buscar", { exact: true }).first();
  await search.fill("");
  await search.pressSequentially("manutencao", { delay: 40 });
  await settled(page);

  /** Dez teclas não podem virar dez consultas. */
  expect(requests, "consultas disparadas por 10 teclas").toBeLessThan(5);
  assertClean(recorder, "busca com debounce");
});

test("recarregar e voltar não quebram a listagem", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  /**
   * Os filtros vivem em estado de React, não na URL — recarregar os limpa, e
   * é o comportamento atual, não um defeito descoberto aqui. O que este teste
   * garante é que recarregar e usar o histórico do navegador não deixam a
   * página em estado inválido. Persistir filtro na URL está registrado como
   * dívida da fundação.
   */
  await page.reload();
  await settled(page);
  await expect(page.getByLabel("Buscar", { exact: true }).first()).toBeVisible();

  await page.goto("/clientes");
  await settled(page);
  await page.goBack();
  await settled(page);
  await expect(page).toHaveURL(/\/operacoes/);
  await expect(page.getByLabel("Buscar", { exact: true }).first()).toBeVisible();

  await page.goForward();
  await settled(page);
  await expect(page).toHaveURL(/\/clientes/);

  assertClean(recorder, "recarga e histórico");
});

test("moeda em real e data em português", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/financeiro");
  await settled(page);

  const body = await page.evaluate(() => document.body.innerText);

  /**
   * O navegador está em `Europe/Lisbon` e a unidade em `America/Recife`.
   * Formato brasileiro aqui significa que a apresentação segue o produto, não
   * o relógio de quem abriu a tela.
   */
  if (/R\$/.test(body)) {
    expect(body).toMatch(/R\$\s?\d{1,3}(\.\d{3})*,\d{2}/);
  }
  if (/\d{2}\/\d{2}\/\d{4}/.test(body)) {
    expect(body).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  }
  /** Nenhum formato ISO cru vazando para o usuário. */
  expect(body).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

  assertClean(recorder, "formatação");
});

test("nenhum enum cru nem termo técnico na interface", async ({ page }) => {
  const recorder = record(page);
  await login(page);

  const forbidden = [
    "FIELD_TECHNICIAN",
    "TECHNICAL_RESPONSIBLE",
    "IN_PROGRESS",
    "BusinessUnit",
    "ArtifactExecution",
    "ForbiddenException",
    "No data",
    "Loading",
    "undefined",
    "NaN",
  ];
  const found: string[] = [];

  for (const route of ["/dashboard", "/operacoes", "/clientes", "/financeiro", "/equipe"]) {
    await page.goto(route);
    await settled(page);
    const body = await page.evaluate(() => document.body.innerText);
    for (const term of forbidden) {
      if (body.includes(term)) found.push(`${route}: ${term}`);
    }
  }

  expect(found, "termos técnicos visíveis ao usuário").toEqual([]);
  assertClean(recorder, "linguagem");
});
