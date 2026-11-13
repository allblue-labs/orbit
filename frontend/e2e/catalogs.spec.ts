/**
 * Central de Catálogos.
 *
 * ## O que se prova
 *
 * Que o roteiro que o técnico percorre em campo passou a ter tela. Ele existia
 * no contrato desde sempre — `ChecklistTemplate`, com CRUD completo — e
 * **nenhuma superfície o oferecia**: os roteiros existentes tinham entrado por
 * seed ou por chamada direta à API, e um dono de organização não tinha como
 * criar o seu nem corrigir um item errado.
 *
 * Prova também que o roteiro criado aqui **chega ao formulário de
 * atendimento**, que é o motivo de ele existir: escolher o tipo traz o roteiro
 * daquele tipo, sem seletor de checklist.
 */
import { expect, test } from "@playwright/test";

import { scenarioId } from "./provision";
import { assertClean, login, record, settled } from "./support";

test("cadastra um roteiro, e ele chega ao atendimento", async ({ page }) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);

  await page.goto("/catalogos");
  await settled(page);

  /** As duas abas de catálogo, e nenhuma inventada. */
  await expect(page.getByRole("tab", { name: "Atendimentos" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Unidades de PMOC" }),
  ).toBeVisible();

  const marca = scenarioId().slice(0, 8);
  const nome = `Instalação ${marca}`;

  await page.getByRole("button", { name: "Novo roteiro" }).first().click();
  await page.locator("#template-name").fill(nome);

  await page.locator("#template-kind").click();
  await page.getByRole("option", { name: "Instalação" }).click();

  await expect(page.locator("#template-kind")).toContainText("Instalação");

  for (const item of ["Conferir nivelamento", "Testar estanqueidade"]) {
    await page.locator("#template-new-item").fill(item);
    await page.getByRole("button", { name: "Adicionar" }).click();
  }
  await expect(page.getByText("2 item(ns)")).toBeVisible();

  await page.getByRole("button", { name: "Criar" }).click();

  /**
   * Ancorado na linha deste roteiro.
   *
   * "2 itens · versão 1" descreve qualquer roteiro de dois itens, e o catálogo
   * acumula os de execuções anteriores — procurar o texto na página inteira
   * reprovava por ambiguidade, não por defeito.
   */
  const linha = page.locator("li").filter({ hasText: nome });
  await expect(linha).toBeVisible({ timeout: 20_000 });
  await expect(linha.getByText("2 itens · versão 1")).toBeVisible();

  /* ---------------------------------------------------------------- */
  /* O roteiro chega ao formulário de atendimento                      */
  /* ---------------------------------------------------------------- */

  await page.goto("/operacoes");
  await settled(page);
  await page
    .getByRole("button", { name: /Nova opera/i })
    .first()
    .click();

  const dialog = page.getByRole("dialog", {
    name: "Nova operação",
    exact: true,
  });
  const next = dialog.getByRole("button", { name: "Continuar", exact: true });
  await next.click();
  await dialog.locator("#operation-kind").click();
  await page.getByRole("option", { name: "Instalação", exact: true }).click();
  await dialog.locator("#operation-title").fill(`Instalação ${marca}`);
  await next.click();
  await next.click();
  // A specific checklist is explicitly selected; only general ones are defaults.
  await dialog.locator("#operation-checklist-add").click();
  await page.getByRole("option", { name: new RegExp(nome) }).click();
  await expect(dialog.getByText("Conferir nivelamento")).toBeVisible();
  await expect(dialog.getByText("Testar estanqueidade")).toBeVisible();

  assertClean(recorder, "central de catálogos");
});

test("o endereço antigo das unidades leva à Central", async ({ page }) => {
  await login(page);

  /**
   * O cadastro de unidades nasceu como rota solta dentro de PMOC.
   *
   * O endereço já circulou — está em link dentro do assistente e no histórico
   * de quem usou —, então ele continua levando ao lugar certo em vez de dar 404.
   */
  await page.goto("/pmoc/unidades");
  await page.waitForURL(/\/catalogos\?secao=pmoc/, { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: "Unidades atendidas" }),
  ).toBeVisible({ timeout: 20_000 });
});
