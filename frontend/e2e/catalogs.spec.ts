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

  /** A tela explica o que o tipo faz antes de alguém escolher errado. */
  await expect(
    page.getByText(/Quem escolher "Instalação" recebe este roteiro/),
  ).toBeVisible();

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
  await page.getByRole("button", { name: /Nova opera/i }).first().click();

  /**
   * Escolher o tipo é o que traz o roteiro.
   *
   * Não há seletor de checklist no formulário de atendimento, de propósito:
   * escolher um que não é o do tipo seria contradizer o catálogo.
   */
  await page.locator("#operation-kind").click();
  await page.getByRole("option", { name: "Instalação" }).click();

  await expect(page.getByText("Conferir nivelamento")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Testar estanqueidade")).toBeVisible();

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
