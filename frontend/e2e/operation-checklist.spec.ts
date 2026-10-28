/** Seleção manual de modelos e preservação dos snapshots dos atendimentos. */
import { expect, test } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

async function selectTemplate(page: import("@playwright/test").Page) {
  const response = await page.request.get(
    "/api/orbit/checklist-templates?isActive=true&latestOnly=true&limit=100",
  );
  const templates = (await response.json()).data.data as {
    name: string;
    items: { label: string }[];
  }[];
  const template = templates.find((item) =>
    item.items.some((entry) => entry.label === "Limpeza dos filtros"),
  );
  expect(template).toBeDefined();
  const selected = page.getByRole("list", { name: "Checklists selecionados" });
  if (await selected.getByText(template!.name, { exact: true }).count()) return;
  await page.locator("#operation-checklist-add").click();
  await page
    .getByRole("option")
    .filter({ hasText: template!.name })
    .first()
    .click();
}

test("o checklist escolhido entra na execução, com o item extra junto", async ({
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
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  const titulo = `E2E checklist ${Date.now()}`;
  await page.locator("#operation-title").fill(titulo);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();

  await selectTemplate(page);
  await expect(page.getByText("Limpeza dos filtros")).toBeVisible();

  /// Herdado é leitura: não há campo para editar o rótulo.
  const itemHerdado = page.getByText("Limpeza dos filtros");
  await expect(itemHerdado).not.toHaveAttribute("contenteditable", "true");

  await page
    .locator("#operation-checklist-extra")
    .fill("Conferir vazamento no duto novo");
  await page
    .getByRole("button", { name: "Adicionar item", exact: true })
    .click();
  await expect(page.getByText("só neste")).toBeVisible();

  /// Captura a execução criada, que é o que prova o vínculo.
  const criada = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/orbit/operations" &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Criar operação" }).click();

  const corpo = await (await criada).json();
  const operationId = (corpo.data ?? corpo).id as string;
  const executions = await page.request.get(
    `/api/orbit/checklist-executions?operationId=${operationId}`,
  );
  const itens = (await executions.json()).data.data[0].templateSnapshot
    .items as {
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
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.locator("#operation-title").fill("Conferir modelo padrão");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await selectTemplate(page);
  await expect(page.getByText("Limpeza dos filtros")).toBeVisible();

  await expect(page.getByText("Conferir vazamento no duto novo")).toHaveCount(
    0,
  );
});
