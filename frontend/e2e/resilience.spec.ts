/**
 * O que a interface faz quando algo dá errado.
 *
 * Sessão expirada, acesso negado, recurso inexistente, API fora do ar. São os
 * caminhos que ninguém percorre à mão antes de subir — e os que decidem se o
 * produto parece confiável quando falha.
 */
import { expect, test } from "@playwright/test";
import { assertClean, login, record, settled } from "./support";

test("sessão inválida leva ao login, sem laço e sem toast infinito", async ({
  page,
  context,
}) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  /** Sessão destruída por fora, como uma expiração real. */
  await context.clearCookies();
  await page.goto("/operacoes");
  await page.waitForURL(/\/login/, { timeout: 30_000 });

  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();

  /** Um único destino: sem ping-pong entre rota protegida e login. */
  await page.waitForTimeout(2_000);
  await expect(page).toHaveURL(/\/login/);

  expect(recorder.pageErrors, "exceções durante a expiração").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React durante a expiração").toEqual([]);
});

test("recurso inexistente é ausência neutra, não erro técnico", async ({ page }) => {
  const recorder = record(page);
  await login(page);

  /** UUIDv7 válido e inexistente: não revela se é de outro inquilino. */
  await page.goto("/operacoes/01a00000-0000-7000-8000-000000000000");
  await settled(page);

  const body = await page.evaluate(() => document.body.innerText);
  expect(body).not.toMatch(/EntityNotFound|Exception|Prisma|P2\d{3}/);
  expect(body).toMatch(/não está disponível|não encontrad|indisponív|sem acesso/i);

  /** Nem o nome interno da entidade nem o identificador voltam para a tela. */
  expect(body).not.toContain("01a00000-0000-7000-8000-000000000000");
  expect(body).not.toMatch(/was not found|with identifier/i);

  expect(recorder.pageErrors, "exceções no recurso inexistente").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React no recurso inexistente").toEqual([]);
});

test("API fora do ar mostra erro com nova tentativa e código de referência", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);

  /**
   * O BFF responde 500 com o envelope público. É o caminho que produz
   * `requestId` — a referência que o suporte pede.
   */
  await page.route("**/api/orbit/operations**", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Não foi possível concluir a solicitação.",
          status: 500,
        },
        requestId: "01a0-referencia-de-teste",
        timestamp: new Date().toISOString(),
      }),
    }),
  );

  /**
   * Recarrega em vez de navegar.
   *
   * Uma navegação dentro da mesma sessão pode ser servida pelo cache do
   * TanStack Query — a requisição nem sai, e a interceptação não vale de nada.
   * O recarregamento descarta o cache em memória e força a busca a acontecer
   * com a rota já interceptada.
   */
  await page.goto("/operacoes");
  await page.reload();

  /**
   * A consulta tenta de novo antes de desistir — é a política de resiliência
   * do cliente, e o estado de erro só aparece quando ela se esgota. Esperar
   * pelo botão de nova tentativa é esperar por esse fim; um instantâneo logo
   * após a navegação pega a tela ainda carregando.
   */
  await expect(
    page.getByRole("button", { name: /tentar novamente/i }).first(),
  ).toBeVisible({ timeout: 30_000 });

  const body = await page.evaluate(() => document.body.innerText);

  /** Mensagem de negócio, nunca a classe de exceção. */
  expect(body).not.toMatch(/Exception|PrismaClient|stack|at Object\./);
  expect(body).toMatch(/não foi possível/i);
  expect(body, "referência de suporte visível").toContain("01a0-referencia-de-teste");

  expect(recorder.pageErrors, "exceções no estado de erro").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React no estado de erro").toEqual([]);
});

test("lista sem resultado explica em português e não fica em branco", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  const search = page.getByLabel("Buscar", { exact: true }).first();
  await search.fill("zzz-nada-encontra-isto-zzz");
  /** A busca é debounced: esperar o ciclo antes de afirmar o que apareceu. */
  await page.waitForTimeout(2_000);
  await settled(page);

  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toMatch(/nenhuma operação encontrada/i);
  expect(body).not.toMatch(/No data|Empty|not found/i);
  /** Concordância: "Nenhum operação" apareceu aqui antes desta PR. */
  expect(body).not.toMatch(/Nenhum operação|Nenhum execução|Nenhum despesa/);

  assertClean(recorder, "estado vazio");
});

test("texto do usuário é renderizado como texto, nunca executado", async ({ page }) => {
  const recorder = record(page);
  let alerted = false;
  page.on("dialog", async (dialog) => {
    alerted = true;
    await dialog.dismiss();
  });

  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  const payload = '<img src=x onerror="window.__xss=1">';
  await page.getByLabel("Buscar", { exact: true }).first().fill(payload);
  await settled(page);

  const executed = await page.evaluate(
    () => (window as unknown as { __xss?: number }).__xss === 1,
  );
  expect(executed, "HTML do usuário executado").toBe(false);
  expect(alerted, "diálogo nativo disparado por conteúdo do usuário").toBe(false);

  assertClean(recorder, "sanidade de XSS");
});
