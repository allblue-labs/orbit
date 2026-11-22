/**
 * O Dashboard com dados reais — comparativo, saúde da operação, financeiro,
 * atividades e próximos compromissos — e a página do Financeiro.
 *
 * Alimenta a conta de referência pela própria API (atendimentos, um deles
 * agendado para amanhã, e lançamentos recebidos, pagos e vencidos) e confere
 * que cada painel mostra o que foi lançado. As capturas ficam em
 * `test-results/dashboard-panels/`, para conferir a olho.
 */
import { expect, test, type Page } from "@playwright/test";

import { activeBusinessUnit, bff, scenarioId } from "./provision";
import { assertClean, login, record } from "./support";

const shot = async (page: Page, name: string, selector?: string) => {
  await page.waitForTimeout(600);
  const alvo = selector ? page.locator(selector) : page;
  await alvo.screenshot({ path: `test-results/dashboard-panels/${name}.png` });
};

const dia = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

test("o painel conta o que aconteceu, o que vem e como está o caixa", async ({ page }) => {
  test.setTimeout(120_000);
  const recorder = record(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const id = scenarioId();
  const unidade = await activeBusinessUnit(page);

  /* Um atendimento para amanhã e um concluído hoje. */
  const amanha = new Date(Date.now() + 26 * 3_600_000);
  const agendado = await bff(page, "post", "/api/orbit/operations", {
    businessUnitId: unidade,
    code: `PAINEL-${id}-A`.toUpperCase(),
    kind: "MAINTENANCE",
    title: `Preventiva agendada ${id}`,
    scheduledStart: amanha.toISOString(),
    scheduledEnd: new Date(amanha.getTime() + 2 * 3_600_000).toISOString(),
  });
  expect(agendado.ok(), await agendado.text()).toBe(true);

  /* Mais dez abertos hoje: a lista de atividades passa de uma página. */
  for (let i = 0; i < 10; i += 1) {
    const extra = await bff(page, "post", "/api/orbit/operations", {
      businessUnitId: unidade,
      code: `PAINEL-${id}-X${i}`.toUpperCase(),
      kind: "MAINTENANCE",
      title: `Corretiva ${i} ${id}`,
    });
    expect(extra.ok(), await extra.text()).toBe(true);
  }

  /* Caixa: recebido, a receber vencido e pago. */
  const lancamentos = [
    { type: "INCOME", amount: 1850, description: `Manutenção mensal ${id}`, competenceDate: dia(-2), confirm: true },
    { type: "INCOME", amount: 640, description: `Higienização ${id}`, competenceDate: dia(-5), dueDate: dia(-1), confirm: false },
    { type: "EXPENSE", amount: 420.5, description: `Gás refrigerante ${id}`, competenceDate: dia(-3), confirm: true },
  ];
  for (const { confirm, ...entry } of lancamentos) {
    const created = await bff(page, "post", "/api/orbit/financial/entries", {
      ...entry,
      businessUnitId: unidade,
    });
    expect(created.ok(), await created.text()).toBe(true);
    if (confirm) {
      const body = await created.json();
      const confirmed = await bff(
        page,
        "post",
        `/api/orbit/financial/entries/${(body.data ?? body).id}/confirm`,
      );
      expect(confirmed.ok(), await confirmed.text()).toBe(true);
    }
  }

  await page.goto("/dashboard");

  const upcoming = page.locator('[data-panel="upcoming-events"]');
  await expect(upcoming.getByText(`Preventiva agendada ${id}`, { exact: false })).toBeVisible();
  await expect(upcoming.getByText("Atendimento agendado").first()).toBeVisible();

  const activity = page.locator('[data-panel="recent-activity"]');
  await expect(activity.getByText("Atendimento aberto").first()).toBeVisible();
  /* Dez por página; a preventiva foi aberta antes das corretivas. */
  await expect(activity.locator("li")).toHaveCount(10);
  await expect(activity.getByText(/^1–10 de \d+$/)).toBeVisible();
  await activity.getByRole("button", { name: "Próxima página" }).click();
  await expect(activity.getByText(/^2 \/ \d+$/)).toBeVisible();
  await expect(activity.getByText(`Preventiva agendada ${id}`, { exact: false }).first()).toBeVisible();
  await shot(page, "4b_atividades_pagina2", '[data-panel="recent-activity"]');
  await activity.getByRole("button", { name: "Página anterior" }).click();

  const financeiro = page.locator('[data-panel="financial-health"]');
  await expect(financeiro.getByText("Vencido a cobrar")).toBeVisible();
  await financeiro.getByRole("button", { name: "7 dias", exact: true }).click();
  await expect(financeiro.locator(".recharts-bar-rectangle path").first()).toBeVisible();

  const saude = page.locator('[data-panel="health-score"]');
  await expect(saude.getByText("Fila em aberto", { exact: true })).toBeVisible();
  await expect(saude.getByText("Volume do mês", { exact: true })).toBeVisible();
  await expect(saude.getByText("Demandas abertas")).toBeVisible();
  const radar = page.locator('[data-panel="operations-comparative-radar"]');
  await expect(radar.getByText("Concluídos no prazo").or(radar.getByText("Demandas com técnico")).first()).toBeVisible();

  await shot(page, "1_comparativo", '[data-panel="operations-comparative-radar"]');
  await shot(page, "2_financeiro", '[data-panel="financial-health"]');
  await shot(page, "3_saude", '[data-panel="health-score"]');
  await shot(page, "4_atividades", '[data-panel="recent-activity"]');
  await shot(page, "5_proximos", '[data-panel="upcoming-events"]');

  await page.goto("/financeiro");
  const fluxo = page.locator('[data-panel="financial-timeline"]');
  await expect(fluxo.getByRole("button", { name: "15 dias", exact: true })).toBeVisible();
  const situacao = page.locator('[data-panel="financial-status"]');
  await expect(situacao.getByText("Vencido (a cobrar)")).toBeVisible();
  await shot(page, "6_financeiro_fluxo", '[data-panel="financial-timeline"]');
  await shot(page, "7_financeiro_situacao", '[data-panel="financial-status"]');

  assertClean(recorder, "dashboard");
});
