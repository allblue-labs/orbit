/**
 * As unidades atendidas de um PMOC.
 *
 * ## O que se prova
 *
 * Que o owner cadastra a unidade com o roteiro dela uma vez, que o assistente
 * a oferece num passo **antes** da revisão, e que o que ele marcou chega ao
 * plano — aparecendo no detalhe com o roteiro ao lado.
 *
 * O estado vazio é parte do contrato desta tela: uma organização sem unidade
 * cadastrada precisa ver o caminho para cadastrar, e não uma lista em branco.
 */
import { expect, test } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

test("o owner cadastra a unidade e o assistente a declara no plano", async ({
  page,
}) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await login(page);

  /* ---------------------------------------------------------------- */
  /* Cadastro                                                          */
  /* ---------------------------------------------------------------- */

  await page.goto("/pmoc");
  await settled(page);

  /**
   * O caminho para o cadastro sai da própria lista de planos.
   *
   * O destino mudou: o cadastro de unidades saiu de uma rota solta dentro de
   * PMOC e passou a viver na Central de Catálogos, ao lado dos roteiros de
   * atendimento — é a mesma natureza de cadastro.
   */
  await page.getByRole("link", { name: "Unidades" }).click();
  await page.waitForURL(/\/catalogos\?secao=pmoc/);
  await settled(page);

  const nome = `Condensadora E2E ${Date.now()}`;
  await page.getByRole("button", { name: /Nova unidade/i }).click();
  await page.locator("#pmoc-unit-name").fill(nome);

  /// A chave é derivada do nome: ninguém a digita para criar.
  await expect(page.locator("#pmoc-unit-key")).toHaveValue(/^CONDENSADORA_E2E/);

  await page.locator("#pmoc-unit-template").click();
  const roteiro = page.getByRole("option").nth(1);
  const rotuloRoteiro = ((await roteiro.textContent()) ?? "").trim();
  await roteiro.click();

  await page.getByRole("button", { name: "Criar unidade" }).click();
  await expect(page.getByText(nome)).toBeVisible();

  /* ---------------------------------------------------------------- */
  /* O passo no assistente                                             */
  /* ---------------------------------------------------------------- */

  await page.goto("/pmoc");
  await settled(page);
  await page.getByRole("button", { name: /Novo PMOC/i }).first().click();

  await page.locator("#pmoc-customer").click();
  await page.getByRole("option").first().click();
  await page.locator("#pmoc-name-option").click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Continuar" }).click();

  /// Equipamentos: um basta para o plano existir.
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "Continuar" }).click();

  /// Programação: os padrões já servem.
  await page.getByRole("button", { name: "Continuar" }).click();

  /// Responsáveis: pode ficar para depois.
  await page.getByRole("button", { name: "Continuar" }).click();

  /**
   * Aqui está o passo novo — e ele vem **antes** da revisão.
   *
   * Se ele tivesse sido inserido depois, a projeção seria calculada sem as
   * unidades e o botão final criaria o plano sem elas.
   */
  await expect(
    page.getByText("Etapa 5 de 6 — Unidades"),
  ).toBeVisible();
  await expect(page.getByText("Unidades atendidas")).toBeVisible();

  const item = page.locator("li").filter({ hasText: nome });
  await expect(item).toBeVisible();

  /**
   * O roteiro aparece junto do nome — na **mesma linha**.
   *
   * Asserção ancorada na linha de propósito: a organização tem outras unidades
   * com o mesmo roteiro, e procurar o texto na página inteira passaria mesmo se
   * esta linha não o mostrasse.
   */
  await expect(
    item.getByText(
      new RegExp(`Roteiro: ${escapeRegExp(rotuloRoteiro.split(" ·")[0]!)}`),
    ),
  ).toBeVisible();

  await page.getByRole("checkbox", { name: nome }).check();
  await expect(page.getByText(/1 de \d+ marcada/)).toBeVisible();

  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByText("Etapa 6 de 6 — Revisão")).toBeVisible();

  /* ---------------------------------------------------------------- */
  /* O que foi marcado chega ao plano                                  */
  /* ---------------------------------------------------------------- */

  const criacao = page.waitForResponse(
    (response) =>
      response.url().includes("/pmoc/plans") &&
      response.request().method() === "POST" &&
      !response.url().includes("preview"),
  );
  await page.getByRole("button", { name: "Criar PMOC" }).click();
  const corpo = await (await criacao).json();
  const planoId = (corpo.data ?? corpo).id as string;

  await page.goto(`/pmoc/${planoId}`);
  await settled(page);

  /// O detalhe publica a unidade declarada, com o roteiro ao lado.
  await expect(
    page.getByText("Unidades atendidas", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(nome, { exact: false }).first()).toBeVisible();

  assertClean(recorder, "unidades de PMOC");
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
