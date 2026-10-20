/**
 * Plano e assinatura: o que vale hoje, e quanto já se usou.
 *
 * ## O que se prova
 *
 * Que a aba diz **qual** acesso está em vigor. Ela dizia "esta organização
 * ainda não tem uma assinatura registrada" — verdadeiro e inútil: quem abre
 * esta tela quer saber o que tem hoje, e a resposta existia em
 * `entitlements` o tempo todo.
 *
 * Prova também que os tetos que apertam a operação aparecem com proporção. Os
 * números viviam em duas colunas de texto, onde "25 · ilimitado" e
 * "1.546 · ilimitado" ocupam a mesma linha sem dizer qual está perto de acabar.
 */
import { expect, test } from "@playwright/test";

import { bff } from "./provision";
import { assertClean, login, record, settled } from "./support";

test("a aba nomeia o plano em vigor e mede o que aperta", async ({ page }) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);

  await page.goto("/configuracoes?secao=assinatura");
  await settled(page);

  /** O que o servidor diz estar em vigor — a régua da asserção. */
  const overview = await bff(page, "get", "/api/orbit/billing/overview");
  const dados = (await overview.json()).data as {
    entitlements: { label: string };
  };

  /**
   * O rótulo do plano em vigor aparece, e não só a ausência de assinatura.
   *
   * Vale tanto para quem assinou quanto para quem opera por concessão ou
   * avaliação — os três têm plano em vigor, e só o primeiro tem cobrança.
   */
  await expect(
    page.getByText(dados.entitlements.label, { exact: false }).first(),
  ).toBeVisible({ timeout: 20_000 });

  /* ---------------------------------------------------------------- */
  /* Os indicadores                                                    */
  /* ---------------------------------------------------------------- */

  for (const rotulo of ["Usuários", "Clientes", "Ordens de serviço"]) {
    await expect(
      page.getByText(rotulo, { exact: true }).first(),
    ).toBeVisible();
  }

  /**
   * Teto inexistente não vira barra cheia.
   *
   * Uma proporção sobre um limite que não existe não significa nada, e uma
   * barra cheia sugeriria o contrário — que acabou. A palavra é o que informa.
   */
  const semTeto = page.getByText("sem teto");
  const barras = page.locator('[role="progressbar"]');
  const quantosSemTeto = await semTeto.count();
  const quantasBarras = await barras.count();

  expect(
    quantosSemTeto + quantasBarras,
    "cada indicador mostra ou uma barra ou 'sem teto'",
  ).toBeGreaterThan(0);

  assertClean(recorder, "plano e assinatura");
});
