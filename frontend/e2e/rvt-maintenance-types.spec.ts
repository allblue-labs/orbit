/**
 * Tipos de manutenção de RVT.
 *
 * ## O que se prova
 *
 * Que o ritmo de uma visita técnica deixou de ser um literal de dois valores
 * gravado na configuração. Antes, uma organização que fizesse manutenção
 * trimestral não tinha onde dizer isso — só semanal ou semestral — e não havia
 * onde declarar o que o técnico confere em cada tipo.
 *
 * Prova as duas metades: que o tipo se cadastra com cadência e roteiro na
 * Central de Catálogos, e que ele **chega ao formulário do contrato**, que é o
 * motivo de existir.
 */
import { expect, test } from "@playwright/test";

import { scenarioId } from "./provision";
import { assertClean, login, record, settled } from "./support";

test("cadastra um tipo de manutenção, e ele chega ao contrato", async ({
  page,
}) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);

  const marca = scenarioId().slice(0, 8);
  const roteiro = `Visita RVT ${marca}`;
  const tipo = `Quadrimestral ${marca}`;

  /* O roteiro primeiro: é ele que o tipo vai carregar. */
  await page.goto("/catalogos?secao=roteiros");
  await settled(page);
  await page.getByRole("button", { name: "Novo roteiro" }).first().click();
  await page.locator("#template-name").fill(roteiro);
  await page.locator("#template-new-item").fill("Medir pressão de sucção");
  await page.getByRole("button", { name: "Adicionar" }).click();
  await page.getByRole("button", { name: "Criar" }).click();
  await expect(page.locator("li").filter({ hasText: roteiro })).toBeVisible({
    timeout: 20_000,
  });

  /* ---------------------------------------------------------------- */
  /* O tipo, com cadência em meses e o roteiro                         */
  /* ---------------------------------------------------------------- */

  await page.getByRole("tab", { name: "RVT" }).click();

  /** Os ritmos que a organização recebe ao nascer, com a cadência à vista. */
  const trimestral = page.locator("li").filter({ hasText: "Trimestral" });
  await expect(trimestral).toBeVisible({ timeout: 20_000 });
  await expect(trimestral.getByText("a cada 3 meses")).toBeVisible();

  await page.getByRole("button", { name: "Novo tipo" }).first().click();
  await page.locator("#rvt-tipo-label").fill(tipo);
  await page.locator("#rvt-tipo-intervalo").fill("4");

  /**
   * Meses, e não 90 dias.
   *
   * Quatro meses civis vão de 120 a 123 dias conforme a data de partida. O
   * formulário diz qual das duas contagens está sendo escolhida antes de
   * alguém escolher a errada.
   */
  await expect(page.getByText(/Meses seguem o calendário/)).toBeVisible();

  await page.locator("#rvt-tipo-roteiro").click();
  await page.getByRole("option", { name: new RegExp(roteiro) }).click();
  await page.getByRole("button", { name: "Cadastrar" }).click();

  const linha = page.locator("li").filter({ hasText: tipo });
  await expect(linha).toBeVisible({ timeout: 20_000 });
  await expect(linha.getByText("a cada 4 meses")).toBeVisible();
  await expect(linha.getByText(`${roteiro} · versão 1`)).toBeVisible();

  /* ---------------------------------------------------------------- */
  /* O tipo chega ao formulário do contrato                            */
  /* ---------------------------------------------------------------- */

  await page.goto("/rvt");
  await settled(page);
  await page.getByRole("button", { name: /Nova visita|Nova configura/i })
    .first()
    .click();

  await page.locator("#rvt-type").click();

  /**
   * A cadência viaja junto no seletor.
   *
   * Quem contrata precisa ver o que está contratando: "Quadrimestral" sozinho
   * não diz se são quatro meses ou quatro visitas.
   */
  await expect(
    page.getByRole("option", { name: `${tipo} · a cada 4 meses` }),
  ).toBeVisible({ timeout: 20_000 });

  assertClean(recorder, "tipos de manutenção de RVT");
});
