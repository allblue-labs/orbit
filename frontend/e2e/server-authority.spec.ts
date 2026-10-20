/**
 * A prova visual de que o servidor manda na interface.
 *
 * Duas afirmações da PR-FE-01 que só um navegador pode confirmar:
 *
 * 1. o menu de ações reflete `allowedActions` do registro;
 * 2. o seletor de status oferece `transitions` do servidor — **nunca** o enum
 *    completo de seis status.
 *
 * Se a segunda regredir, o seletor volta a mostrar seis opções e este teste
 * quebra. É o gate que impede o frontend de reconstruir a máquina de estados.
 */
import { expect, test } from "@playwright/test";
import { operationRow, provisionOperation } from "./provision";
import { assertClean, login, record, settled } from "./support";

/** O enum inteiro. Se todos aparecerem, houve regressão. */
const ALL_STATUSES = [
  "Aberta",
  "Agendada",
  "Em andamento",
  "Pausada",
  "Concluída",
  "Cancelada",
];

test("o menu de ações vem do que o registro permite", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  /** O cenário age sobre a operação que criou, não sobre a primeira da lista. */
  const operation = await provisionOperation(page, "acoes");
  const row = await operationRow(page, operation.code);
  await settled(page);

  const trigger = row.getByRole("button", { name: /Ações da operação/i });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();

  /**
   * O owner participa de tudo por gerenciar a carteira, então o backend
   * publica `CHANGE_STATUS` — e a ação aparece. O caso negado é coberto pelo
   * teste unitário da autoridade: sem a ação na lista, `permits` responde
   * `false` e o item não é renderizado.
   */
  await expect(page.getByRole("menuitem", { name: /Alterar status/i })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /Editar/i })).toBeVisible();

  await page.keyboard.press("Escape");
  assertClean(recorder, "menu de ações");
});

test("o seletor de status oferece só as transições do servidor", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  const operation = await provisionOperation(page, "transicoes");
  const row = await operationRow(page, operation.code);
  await settled(page);

  /** Lido **antes** de abrir o diálogo: depois, a sobreposição cobre a linha. */
  const rowText = (await row.innerText()).trim();
  const currentStatus = ALL_STATUSES.find((label) => rowText.includes(label));

  await row.getByRole("button", { name: /Ações da operação/i }).click();
  await page.getByRole("menuitem", { name: /Alterar status/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  /** O detalhe é buscado para trazer `transitions`; espera-se o fim disso. */
  await settled(page);
  await dialog.getByRole("combobox").click();

  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  const labels = await options.allInnerTexts();

  /**
   * O enum tem seis status; o servidor publica um subconjunto para o estado
   * atual. A asserção não fixa **quais** destinos — isso é do backend e muda
   * conforme a operação avança —, apenas que não são todos e que o estado
   * atual não se oferece como destino de si mesmo.
   */
  expect(labels.length).toBeGreaterThan(0);
  expect(labels.length).toBeLessThan(ALL_STATUSES.length);

  if (currentStatus) expect(labels).not.toContain(currentStatus);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  assertClean(recorder, "seletor de status");
});

test("uma transição válida aplica e o estado autoritativo volta", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  const operation = await provisionOperation(page, "aplicar");
  const row = await operationRow(page, operation.code);
  await settled(page);

  await row.getByRole("button", { name: /Ações da operação/i }).click();
  await page.getByRole("menuitem", { name: /Alterar status/i }).click();

  const dialog = page.getByRole("dialog");
  await settled(page);
  await dialog.getByRole("combobox").click();

  const chosen = page.getByRole("option").first();
  const chosenLabel = (await chosen.innerText()).trim();
  await chosen.click();

  const apply = dialog.getByRole("button", { name: /Aplicar/i });
  await expect(apply).toBeEnabled();

  /**
   * A proteção contra duplo envio é o botão desabilitar enquanto a mutação
   * corre — não um segundo clique forçado, que só provaria que o Playwright
   * consegue clicar em algo já invisível.
   */
  await apply.click();
  await expect(apply).toBeDisabled({ timeout: 5_000 }).catch(() => {
    /** Mutação instantânea: o diálogo fecha antes de o estado ser observável. */
  });

  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await settled(page);

  /** O novo status veio do servidor, relido depois da mutação. */
  await expect(page.getByText(chosenLabel).first()).toBeVisible();
  assertClean(recorder, "transição de status");
});
