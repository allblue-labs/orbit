/**
 * PMOC V2 em navegador real.
 *
 * O que estes testes travam é a separação do domínio: configuração, execução
 * execução por equipamento e documento são quatro coisas, e a tela não pode
 * do plano e equipamento. Um "Gerar PDF" na configuração ou na execução reprova
 * aqui — porque o documento pertence a cada equipamento executado.
 */
import { expect, test } from "@playwright/test";
import { assertClean, login, record, settled } from "./support";
import { seededPmocPlanId } from "./provision";

/** O plano do seed, identificado pelo código — o nome é editável. */
const PLANO_SEMEADO = "PMOC-2026-001";

test("a lista mostra configurações, não as execuções delas", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/pmoc");
  await settled(page);

  await expect(page.getByRole("columnheader", { name: "Plano" })).toBeVisible();
  const body = await page.evaluate(() => document.body.innerText);

  expect(body).toContain("PMOC-2026-001");
  expect(body).toContain("Responsável Técnico");
  /** Periodicidade em português, resolvida pelo servidor. */
  expect(body).toMatch(/a cada 6 mes|6 mês|6 mes/i);

  assertClean(recorder, "lista de PMOC");
});

test("a configuração não oferece geração de documento", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto(`/pmoc/${await seededPmocPlanId(page, PLANO_SEMEADO)}`);
  await settled(page);

  await expect(page.getByRole("tab", { name: "Visão geral" })).toBeVisible();

  /**
   * Nem na configuração nem na execução. Documento é por equipamento —
   * a interface não pode sugerir um PDF único do plano.
   */
  for (const tab of ["Visão geral", "Execuções"]) {
    await page.getByRole("tab", { name: tab }).click();
    await settled(page);
    const body = await page.evaluate(() => document.body.innerText);
    expect(body, `${tab} oferecendo PDF`).not.toMatch(/gerar pdf|baixar pdf/i);
  }

  assertClean(recorder, "detalhe do plano");
});

test("a execução mostra progresso e o bloqueio real de cada equipamento", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  await page.goto(`/pmoc/${await seededPmocPlanId(page, PLANO_SEMEADO)}`);
  await page.getByRole("tab", { name: "Execuções" }).click();
  await settled(page);

  /** A execução é competência, com vencimento — não ordem de serviço. */
  await expect(page.getByText(/Execução 1/)).toBeVisible();
  await expect(page.getByText(/Vencimento/)).toBeVisible();

  /**
   * O Responsável Técnico do cenário não tem assinatura cadastrada, e o
   * servidor devolve `SIGNATURE_MISSING`. A tela mostra a frase, nunca o
   * código.
   */
  await expect(
    page.getByText(/Assinatura profissional não cadastrada/i).first(),
  ).toBeVisible({ timeout: 20_000 });

  const body = await page.evaluate(() => document.body.innerText);
  expect(body).not.toContain("SIGNATURE_MISSING");

  assertClean(recorder, "execuções");
});

test("a cobertura pagina pelo cursor do servidor", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto(`/pmoc/${await seededPmocPlanId(page, PLANO_SEMEADO)}`);
  await page.getByRole("tab", { name: "Cobertura" }).click();
  await settled(page);

  await expect(
    page.getByRole("columnheader", { name: "Equipamento" }),
  ).toBeVisible();

  /** Cursor: avançar e voltar, sem número de página inventado. */
  await expect(page.getByRole("button", { name: "Anterior" })).toBeDisabled();
  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toContain("Split Cassete");

  assertClean(recorder, "cobertura");
});

test("nenhum código de contrato aparece nas telas de PMOC", async ({ page }) => {
  const recorder = record(page);
  await login(page);

  const forbidden = [
    "PMOC_EQUIPMENT_EXECUTION",
    "TECHNICAL_RESPONSIBLE",
    "FIELD_TECHNICIAN",
    "IN_PROGRESS",
    "PLAN_NOT_ACTIVE",
    "CYCLE_NOT_PENDING",
    "EQUIPMENT_INACTIVE",
    "SIGNATURE_MISSING",
    "UP_TO_DATE",
    "DUE_SOON",
  ];
  const found: string[] = [];

  await page.goto(`/pmoc/${await seededPmocPlanId(page, PLANO_SEMEADO)}`);
  await settled(page);

  for (const tab of ["Visão geral", "Cobertura", "Execuções", "Histórico"]) {
    await page.getByRole("tab", { name: tab }).click();
    await settled(page);
    const body = await page.evaluate(() => document.body.innerText);
    for (const term of forbidden) {
      if (body.includes(term)) found.push(`${tab}: ${term}`);
    }
  }

  expect(found, "códigos de contrato visíveis").toEqual([]);
  assertClean(recorder, "linguagem do PMOC");
});

test("o deep link do plano abre e recarrega", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto(`/pmoc/${await seededPmocPlanId(page, PLANO_SEMEADO)}`);
  /** Navegação de cliente: esperar a URL, não o silêncio da rede. */
  await page.waitForURL(/\/pmoc\/[0-9a-f-]+$/, { timeout: 20_000 });
  await settled(page);

  await page.reload();
  await settled(page);
  await expect(page.getByRole("tab", { name: "Execuções" })).toBeVisible();

  assertClean(recorder, "deep link");
});

test("plano inexistente é ausência neutra", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/pmoc/01a00000-0000-7000-8000-000000000000");
  await settled(page);

  const body = await page.evaluate(() => document.body.innerText);
  expect(body).toMatch(/não está disponível|não encontrad|indisponív/i);
  expect(body).not.toMatch(/was not found|EntityNotFound|Prisma/);

  expect(recorder.pageErrors).toEqual([]);
  expect(recorder.reactWarnings).toEqual([]);
});
