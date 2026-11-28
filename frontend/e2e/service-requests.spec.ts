/**
 * Chamados na plataforma — da fila ao atendimento e ao orçamento.
 *
 * Um cliente real abre o chamado pelo portal (BFF do cliente, cookies
 * próprios); a equipe recebe na fila, abre a ficha e usa os botões do cartão.
 * Os dois fluxos precisam chegar preenchidos com o que o cliente escreveu.
 *
 * As capturas ficam em `test-results/service-requests/`, para conferir a olho.
 */
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { activeBusinessUnit, bff, scenarioId } from "./provision";
import { assertClean, login, record } from "./support";

/* Painéis entram deslizando (500 ms): a foto espera a animação acabar. */
const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `test-results/service-requests/${name}.png` });
};

function cnpj(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const digit = (digits: number[]) => {
    const weights =
      digits.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest = digits.reduce((total, d, i) => total + d * weights[i]!, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit(base);
  return [...base, first, digit([...base, first])].join("");
}

async function data<T>(response: { ok(): boolean; text(): Promise<string>; json(): Promise<unknown> }): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  if (!text) return undefined as T;
  const body = JSON.parse(text) as { data?: T };
  return (body.data ?? body) as T;
}

/** O cliente, com sessão própria no BFF do portal. */
async function portal(origin: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      Origin: origin,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
    },
  });
}

test("o chamado vira atendimento e orçamento com os dados do cliente", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  const id = scenarioId();
  const origin = new URL(page.url()).origin;

  /* O cliente e o acesso dele, pela própria API da plataforma. */
  const customer = await data<{ id: string }>(
    await bff(page, "post", "/api/orbit/customers", {
      type: "COMPANY",
      legalName: `Clínica Chamado ${id}`,
      documentType: "CNPJ",
      documentNumber: cnpj(),
    }),
  );
  const access = await data<{ identity: { email: string }; temporaryPassword: string }>(
    await bff(page, "post", `/api/orbit/customers/${customer.id}/portal/access`, {
      localPart: `chamado.${id}`,
    }),
  );

  const cliente = await portal(origin);
  await data(
    await cliente.post("/api/portal/auth/login", {
      data: { email: access.identity.email, password: access.temporaryPassword },
    }),
  );
  await data(
    await cliente.patch("/api/portal/auth/password", {
      data: { currentPassword: access.temporaryPassword, newPassword: "Orbit#Cliente@2026" },
    }),
  );
  const assunto = `Split pingando na recepção ${id}`;
  await data(
    await cliente.post("/api/portal/me/service-requests", {
      headers: { "idempotency-key": `e2e-${id}` },
      data: {
        category: "EQUIPMENT_PROBLEM",
        subject: assunto,
        description: "Está pingando água sobre a mesa da recepção desde ontem.",
        urgency: "HIGH",
        details: {
          siteLocation: "Recepção, 2º andar",
          availability: "Manhãs, das 8h às 12h",
          contactName: "Ana",
          contactPhone: "(81) 99999-0000",
        },
      },
    }),
  );
  await cliente.dispose();

  /* Um serviço com preço, para o orçamento ter o que oferecer. */
  const unidade = await activeBusinessUnit(page);
  await data(
    await bff(page, "post", "/api/orbit/catalog/products", {
      kind: "SERVICE",
      name: `Visita ${id}`,
      unit: "SERV",
      salePrice: 350,
      businessUnitId: unidade,
    }),
  );

  /* A fila: o cartão tem os dois caminhos. */
  await page.goto("/chamados");
  const cartao = page.getByRole("listitem").filter({ hasText: assunto });
  await expect(cartao).toBeVisible();
  await expect(cartao.getByRole("button", { name: "Abrir atendimento" })).toBeVisible();
  await expect(cartao.getByRole("button", { name: "Orçamento" })).toBeVisible();
  await shot(page, "1_fila");

  /* A ficha. */
  await cartao.getByRole("button", { name: /^Ver o chamado/ }).click();
  const ficha = page.getByRole("dialog");
  await expect(ficha.getByText("Detalhes para o técnico")).toBeVisible();
  await expect(ficha.getByText("Recepção, 2º andar")).toBeVisible();
  await expect(ficha.getByRole("button", { name: "Mais ações" })).toBeVisible();
  await shot(page, "2_ficha");
  await page.keyboard.press("Escape");
  await expect(ficha).toHaveCount(0);

  /* Orçamento: começa nos dados, já preenchido. */
  await cartao.getByRole("button", { name: "Orçamento" }).click();
  const assistente = page.getByRole("dialog", { name: "Novo orçamento" });
  await expect(assistente.getByLabel("Título")).toHaveValue(assunto);
  await expect(assistente.getByLabel("Objeto da proposta")).toHaveValue(
    /pingando água[\s\S]*Local: Recepção, 2º andar[\s\S]*Referente ao chamado/,
  );
  await shot(page, "3_orcamento");

  /* Gerar de verdade: um serviço do catálogo e o resumo aprovado. */
  await assistente.getByRole("button", { name: /^Continuar$/ }).click();
  await assistente.getByPlaceholder("Buscar serviço").fill(`Visita ${id}`);
  await assistente.getByRole("button", { name: /^Adicionar$/ }).first().click();
  for (let passo = 0; passo < 3; passo += 1)
    await assistente.getByRole("button", { name: /^Continuar$/ }).click();
  await assistente.getByRole("checkbox").first().check();
  await assistente.getByRole("button", { name: /Gerar orçamento/ }).click();
  await page.waitForURL(/\/orcamentos\//);

  /* O chamado guarda qual orçamento nasceu dele. */
  await page.goto("/chamados");
  await cartao.getByRole("button", { name: /^Ver o chamado/ }).click();
  await expect(
    page.getByRole("dialog").getByText(/Orçamento .* criado a partir deste chamado/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  /* Atendimento: o que vem do chamado aparece antes de confirmar. */
  await cartao.getByRole("button", { name: "Abrir atendimento" }).click();
  const conversao = page.getByRole("dialog", { name: "Abrir atendimento" });
  await expect(conversao.getByText("Local: ").first()).toBeVisible();
  await expect(conversao.getByLabel("Título")).toHaveValue(assunto);
  await shot(page, "4_atendimento");
  await conversao.getByRole("button", { name: "Abrir atendimento" }).click();
  await expect(page.getByText(/^Atendimento OS-.* aberto$/)).toBeVisible();
  await expect(conversao).toHaveCount(0);

  /* O cartão passa a levar ao atendimento criado. */
  await expect(cartao.getByRole("button", { name: "Abrir atendimento" })).toHaveCount(0);
  await cartao.getByRole("button", { name: /^Ver o chamado/ }).click();
  const link = page.getByRole("dialog").getByRole("link", { name: /Atendimento OS-/ });
  await expect(link).toBeVisible();
  await shot(page, "5_ficha_convertida");
  await link.click();
  await page.waitForURL(/\/operacoes\//);
  await expect(page.getByText("Está pingando água sobre a mesa da recepção desde ontem.").first()).toBeVisible();
  await expect(page.getByText(/Local: Recepção, 2º andar/).first()).toBeVisible();
  await shot(page, "6_atendimento_criado");

  assertClean(recorder, "chamados");
});
