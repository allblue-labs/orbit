/**
 * A aba Certificações com **uma certificação dentro**.
 *
 * ## Por que este teste existe
 *
 * A aba caía inteira na primeira linha que mostrasse o nome de uma pessoa:
 * `UserReference` fazia `members.data.find(...)` porque o tipo do serviço dizia
 * que `GET /organizations/current/members` devolvia um array. O endpoint sempre
 * respondeu `{ data, meta }`. A anotação era uma mentira que o compilador
 * aceitava, e o erro só existia em execução, só com dados.
 *
 * Nenhum teste de unidade pegaria isso: o tipo estava "certo" para o TypeScript,
 * e a lista vazia — o estado em que toda tela nasce — não renderiza nome nenhum.
 * Por isso a asserção é no navegador, e depois de **criar** a certificação.
 *
 * O coletor de console reprova o `TypeError` original mesmo que a tela ainda
 * pareça funcionar.
 */
import { expect, test } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

test("a lista de certificações mostra o nome da pessoa sem quebrar", async ({
  page,
}) => {
  const recorder = record(page);

  await login(page);
  await page.goto("/equipe?secao=certificacoes");
  await settled(page);

  const nome = `NR-35 E2E ${Date.now()}`;

  await page
    .getByRole("button", { name: /Nova certificação/i })
    .first()
    .click();
  await page.getByLabel("Pessoa").click();
  await page.getByRole("option").first().click();
  await page.fill("#certification-name", nome);
  await page.fill("#certification-issuer", "SENAI");
  await page.fill("#certification-expires", "2030-12-31");
  await page.getByRole("button", { name: /^Salvar$/ }).click();

  await settled(page);

  /* A linha existe — o que prova que a tabela renderizou com dados. */
  await expect(page.getByText(nome).first()).toBeVisible();

  /* E a aba não caiu no limite de erro. */
  await expect(
    page.getByText(/Não foi possível exibir as certificações/i),
  ).toHaveCount(0);

  /* `assertClean` é o mesmo crivo do resto do smoke: console, falha de rede e
     avisos que a React só emite como aviso mas são defeito. */
  assertClean(recorder, "aba de certificações");
});
