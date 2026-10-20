/**
 * O formulário de criar calendário.
 *
 * ## O que se prova aqui
 *
 * Que o botão "Criar calendário" alinha pela base do campo "Nome".
 *
 * Ele não alinhava: a linha de ajuda (chave e fuso) ficava dentro da coluna
 * do campo e, com `items-end`, o botão descia para a base **dela** — 25
 * pixels abaixo do campo. Uma asserção de "o botão está visível" passaria com
 * o defeito de pé; por isso aqui se mede a base dos dois.
 *
 * O mesmo componente aparece em Agenda > Visão geral, Agenda > Lembretes e
 * Configurações > Agenda. Este teste usa o caminho das Configurações, que é o
 * único alcançável sem depender de a organização estar sem calendário.
 */
import { expect, test } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

async function abrirFormulario(page: import("@playwright/test").Page) {
  await page.goto("/configuracoes?secao=agenda");
  await settled(page);
  await page.getByRole("button", { name: "Novo calendário" }).click();
  await expect(page.locator("#calendar-name")).toBeVisible();
}

test("o botão alinha pela base do campo, não pela da linha de ajuda", async ({
  page,
}) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1280, height: 1000 });
  await login(page);
  await abrirFormulario(page);

  const campo = await page.locator("#calendar-name").boundingBox();
  const botao = await page
    .getByRole("button", { name: /Criar calendário/ })
    .boundingBox();

  expect(campo).not.toBeNull();
  expect(botao).not.toBeNull();

  const baseDoCampo = campo!.y + campo!.height;
  const baseDoBotao = botao!.y + botao!.height;

  /// Um pixel de tolerância para arredondamento de layout.
  expect(Math.abs(baseDoBotao - baseDoCampo)).toBeLessThanOrEqual(1);

  assertClean(recorder, "formulário de calendário");
});

test("em tela estreita o botão empilha sob o campo, sem estourar", async ({
  page,
}) => {
  /// Abaixo de `sm` a grade vira uma coluna: o botão desce, e isso é o
  /// desejado. O que não pode é a linha vazar para os lados.
  const recorder = record(page);
  await page.setViewportSize({ width: 430, height: 900 });
  await login(page);
  await abrirFormulario(page);

  const campo = await page.locator("#calendar-name").boundingBox();
  const botao = await page
    .getByRole("button", { name: /Criar calendário/ })
    .boundingBox();

  expect(botao!.y).toBeGreaterThan(campo!.y);

  const estouro = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(estouro).toBeLessThanOrEqual(1);

  assertClean(recorder, "formulário de calendário estreito");
});
