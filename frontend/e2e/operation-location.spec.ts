/**
 * O formulário de atendimento: cliente, endereço, setor e equipamentos.
 *
 * ## O que se prova
 *
 * Que o campo "Unidade" saiu — ele pedia a unidade de negócio, que é de quem
 * atende e não de onde o serviço acontece, e vinha do escopo ativo de qualquer
 * jeito. No lugar dele o formulário pergunta o que descreve o atendimento:
 * para qual cliente, em qual endereço dele, em que setor, e sobre quais
 * equipamentos.
 *
 * Prova também que os equipamentos são **do cliente escolhido** e que dá para
 * marcar mais de um. Antes era um só, escolhido num catálogo da organização
 * inteira — dava para anexar o equipamento de outro cliente e só descobrir na
 * recusa do servidor.
 */
import { expect, test } from "@playwright/test";

import { bff, scenarioId } from "./provision";
import { assertClean, login, record, settled } from "./support";

test("cliente, endereço, setor e vários equipamentos", async ({ page }) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1280, height: 1200 });
  await login(page);

  /* ---------------------------------------------------------------- */
  /* Cenário                                                           */
  /* ---------------------------------------------------------------- */

  const marca = scenarioId().slice(0, 8);
  await page.goto("/clientes");
  await settled(page);

  const unidades = await bff(page, "get", "/api/orbit/organizations/current");
  const unidadeId = (await unidades.json()).data.businessUnits[0].id as string;

  const cliente = await bff(page, "post", "/api/orbit/customers", {
    legalName: `Cliente Local ${marca} LTDA`,
    type: "COMPANY",
  });
  const clienteId = (await cliente.json()).data.id as string;

  await bff(page, "post", `/api/orbit/customers/${clienteId}/addresses`, {
    label: `Matriz ${marca}`,
    street: "Rua da Aurora",
    number: "100",
    city: "Recife",
    stateCode: "PE",
  });

  for (const nome of [`Split A ${marca}`, `Split B ${marca}`]) {
    await bff(page, "post", "/api/orbit/assets", {
      businessUnitId: unidadeId,
      customerId: clienteId,
      category: "EQUIPMENT",
      name: nome,
    });
  }

  /* ---------------------------------------------------------------- */
  /* O formulário                                                      */
  /* ---------------------------------------------------------------- */

  await page.goto("/operacoes");
  await settled(page);
  await page.getByRole("button", { name: /Nova opera/i }).first().click();

  /** "Unidade" saiu: ela é de quem atende, não de onde o serviço acontece. */
  await expect(page.locator("#operation-unit")).toHaveCount(0);

  /** Sem cliente, os dois campos dependentes dizem o que falta. */
  await expect(page.getByText("Escolha o cliente primeiro.")).toBeVisible();
  await expect(
    page.getByText(/os equipamentos são os dele/),
  ).toBeVisible();

  await page.locator("#operation-customer").click();
  /** O seletor pagina no servidor: sem buscar, o recém-criado não está na 1ª página. */
  await page.getByPlaceholder("Buscar…").fill(marca);
  await page
    .getByRole("option", { name: `Cliente Local ${marca} LTDA` })
    .click({ timeout: 20_000 });

  /** O endereço cadastrado do cliente aparece, com a linha completa. */
  await page.locator("#operation-address").click();
  await page.getByRole("option", { name: `Matriz ${marca}` }).click();
  await expect(page.getByText(/Rua da Aurora, 100/)).toBeVisible();

  await page.locator("#operation-sector").fill("Auditório");

  /**
   * Os dois equipamentos do cliente, e só eles.
   *
   * O catálogo da organização tem muitos outros; a lista aqui é a do cliente
   * escolhido, que é o que impede anexar o aparelho de terceiro.
   */
  const primeiro = page.getByRole("checkbox", { name: `Split A ${marca}` });
  const segundo = page.getByRole("checkbox", { name: `Split B ${marca}` });
  await expect(primeiro).toBeVisible({ timeout: 20_000 });
  await primeiro.check();
  await segundo.check();
  await expect(page.getByText(/2 de \d+ marcado/)).toBeVisible();

  const titulo = `Atendimento ${marca}`;
  await page.locator("#operation-title").fill(titulo);

  /**
   * A criação da ordem, e **só** ela.
   *
   * `includes("/operations")` casava também com
   * `POST /operations/{id}/checklists`, que o próprio formulário dispara em
   * seguida quando o tipo escolhido tem roteiro. Duas respostas atendiam ao
   * predicado e a promessa resolvia com a que chegasse primeiro — a do
   * checklist não tem `sector`, e o teste reprovava por corrida, não por
   * defeito. Sozinho ele passava; na suíte inteira, não.
   */
  const criacao = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/operations") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Criar operação" }).click();
  const corpo = await (await criacao).json();
  const criada = corpo.data ?? corpo;

  /* ---------------------------------------------------------------- */
  /* O que foi escolhido chega ao atendimento                          */
  /* ---------------------------------------------------------------- */

  expect(criada.sector).toBe("Auditório");
  expect(criada.customerAddress?.label).toBe(`Matriz ${marca}`);
  expect(
    (criada.assets ?? []).map((equipamento: { name: string }) => equipamento.name).sort(),
  ).toEqual([`Split A ${marca}`, `Split B ${marca}`]);

  assertClean(recorder, "formulário de atendimento");
});
