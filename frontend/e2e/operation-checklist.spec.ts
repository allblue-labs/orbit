/**
 * O checklist do atendimento, ao criar uma operação.
 *
 * ## O que se prova
 *
 * Que escolher o tipo traz o roteiro que o dono da organização definiu, que
 * os itens herdados não são editáveis, e que um item acrescentado vale **só
 * para este atendimento** — a execução nasce com os dois, e o modelo segue
 * intacto para o próximo.
 */
import { expect, test } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

test("o checklist do tipo entra na execução, com o item extra junto", async ({
  page,
}) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  await page
    .getByRole("button", { name: /Nova opera/i })
    .first()
    .click();
  await expect(page.locator("#operation-title")).toBeVisible();

  /// O tipo padrão do formulário é Manutenção, que é o que tem modelo.
  await expect(page.getByText("Limpeza dos filtros")).toBeVisible();

  /// Herdado é leitura: não há campo para editar o rótulo.
  const itemHerdado = page.getByText("Limpeza dos filtros");
  await expect(itemHerdado).not.toHaveAttribute("contenteditable", "true");

  const titulo = `E2E checklist ${Date.now()}`;
  await page.locator("#operation-title").fill(titulo);

  await page
    .locator("#operation-checklist-extra")
    .fill("Conferir vazamento no duto novo");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await expect(page.getByText("só neste")).toBeVisible();

  /// Captura a execução criada, que é o que prova o vínculo.
  const criada = page.waitForResponse(
    (r) => r.url().includes("/checklists") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Criar operação" }).click();

  const corpo = await (await criada).json();
  const itens = (corpo.data ?? corpo).templateSnapshot.items as {
    label: string;
  }[];
  const rotulos = itens.map((item) => item.label);

  expect(rotulos).toContain("Limpeza dos filtros");
  expect(rotulos).toContain("Conferir vazamento no duto novo");

  /// Os herdados vêm primeiro: em campo se espera o roteiro conhecido antes
  /// do que foi pedido só para este atendimento.
  expect(rotulos.indexOf("Conferir vazamento no duto novo")).toBe(
    rotulos.length - 1,
  );

  assertClean(recorder, "criação com checklist");
});

test("o modelo não muda por causa do extra de um atendimento", async ({
  page,
}) => {
  /// Se o extra fosse parar no modelo, a próxima operação já nasceria com
  /// ele — e o padrão da organização teria sido reescrito sem ninguém pedir.
  await login(page);
  await page.goto("/operacoes");
  await settled(page);

  await page
    .getByRole("button", { name: /Nova opera/i })
    .first()
    .click();
  await expect(page.getByText("Limpeza dos filtros")).toBeVisible();

  await expect(
    page.getByText("Conferir vazamento no duto novo"),
  ).toHaveCount(0);
});
