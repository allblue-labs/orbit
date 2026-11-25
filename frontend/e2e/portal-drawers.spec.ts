/**
 * As fichas do portal do cliente — chamado, equipamento e atendimento.
 *
 * O cliente entra pela tela de login do portal e abre cada ficha. O que se
 * prova é o que o navegador decide: o painel tem fundo sólido (não deixa ver a
 * página escurecida por trás), o cabeçalho traz o estado e as ações ficam no
 * rodapé. As capturas ficam em `test-results/portal-drawers/`.
 */
import {
  expect,
  request as playwrightRequest,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

import { activeBusinessUnit, bff, scenarioId } from "./provision";
import { assertClean, login, record } from "./support";

const shot = async (page: Page, name: string) => {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `test-results/portal-drawers/${name}.png` });
};

async function data<T>(response: {
  ok(): boolean;
  text(): Promise<string>;
}): Promise<T> {
  const text = await response.text();
  expect(response.ok(), text).toBe(true);
  if (!text) return undefined as T;
  const body = JSON.parse(text) as { data?: T };
  return (body.data ?? body) as T;
}

/** O painel pinta o próprio fundo, opaco — não herda a página por trás. */
async function expectSolid(drawer: Locator) {
  const fundo = await drawer.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const alfa = /rgba?\(([^)]+)\)/
    .exec(fundo)?.[1]
    ?.split(/[\s,/]+/)
    .filter(Boolean)[3];
  expect(
    alfa === undefined || Number(alfa) === 1,
    `fundo do painel: ${fundo}`,
  ).toBe(true);
}

test("as fichas do portal têm fundo, cabeçalho e ações", async ({
  page,
  browser,
}) => {
  await login(page);
  const id = scenarioId();
  const origin = new URL(page.url()).origin;
  const unidade = await activeBusinessUnit(page);

  const customer = await data<{ id: string }>(
    await bff(page, "post", "/api/orbit/customers", {
      type: "COMPANY",
      legalName: `Clínica Portal ${id}`,
    }),
  );
  const asset = await data<{ id: string }>(
    await bff(page, "post", "/api/orbit/assets", {
      name: `Split Recepção ${id}`,
      category: "EQUIPMENT",
      identifierType: "INTERNAL_CODE",
      identifier: `SPL-${id}`.slice(0, 40),
      manufacturer: "Daikin",
      model: "FTXS 12k",
      location: "Recepção",
      businessUnitId: unidade,
      customerId: customer.id,
    }),
  );
  const access = await data<{
    identity: { email: string };
    temporaryPassword: string;
  }>(
    await bff(
      page,
      "post",
      `/api/orbit/customers/${customer.id}/portal/access`,
      {
        localPart: `portal.${id}`,
      },
    ),
  );
  const senha = "Orbit#Cliente@2026";

  /* O cliente troca a senha e abre o chamado; a equipe o converte. */
  const api = await playwrightRequest.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      Origin: origin,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
    },
  });
  await data(
    await api.post("/api/portal/auth/login", {
      data: {
        email: access.identity.email,
        password: access.temporaryPassword,
      },
    }),
  );
  await data(
    await api.patch("/api/portal/auth/password", {
      data: { currentPassword: access.temporaryPassword, newPassword: senha },
    }),
  );
  const assunto = `Split pingando ${id}`;
  const chamado = await data<{ id: string; version: number }>(
    await api.post("/api/portal/me/service-requests", {
      headers: { "idempotency-key": `e2e-${id}` },
      data: {
        category: "EQUIPMENT_PROBLEM",
        subject: assunto,
        description: "Está pingando água sobre a mesa da recepção.",
        assetId: asset.id,
        urgency: "HIGH",
        details: {
          equipmentCondition: "MALFUNCTIONING",
          siteLocation: "Recepção",
          availability: "Manhãs",
        },
      },
    }),
  );
  await api.dispose();
  await data(
    await bff(
      page,
      "post",
      `/api/orbit/customer-service-requests/${chamado.id}/create-operation`,
      {
        expectedVersion: chamado.version,
        businessUnitId: unidade,
        code: `OS-${id}`.toUpperCase(),
        kind: "MAINTENANCE",
        title: "Manutenção do split da recepção",
        description: "Troca do dreno e limpeza da serpentina.",
      },
      { "idempotency-key": `e2e-convert-${id}` },
    ),
  );

  /* Agora como cliente, pela tela de login do portal. */
  const contexto = await browser.newContext({
    locale: "pt-BR",
    viewport: { width: 1440, height: 900 },
  });
  const cliente = await contexto.newPage();
  const recorder = record(cliente);
  await cliente.goto(`${origin}/portal/entrar`);
  await cliente.getByLabel("E-mail de acesso").fill(access.identity.email);
  await cliente.getByLabel("Senha").fill(senha);
  await cliente.getByRole("button", { name: "Entrar", exact: true }).click();
  await cliente.waitForURL(/\/portal$/);

  /* Chamado. */
  await cliente.goto(`${origin}/portal/chamados`);
  await cliente.getByText(assunto).click();
  let ficha = cliente.getByRole("dialog");
  await expect(ficha.getByText("O que você pediu")).toBeVisible();
  await expectSolid(ficha);
  await shot(cliente, "1_chamado");
  await cliente.keyboard.press("Escape");
  await expect(ficha).toHaveCount(0);

  /* Equipamento, com o atendimento dentro. */
  await cliente.goto(`${origin}/portal/equipamentos`);
  await cliente.getByText(`Split Recepção ${id}`).click();
  ficha = cliente.getByRole("dialog");
  await expect(ficha.getByText("Fabricante e modelo")).toBeVisible();
  await expect(
    ficha.getByRole("link", { name: "Abrir chamado sobre este equipamento" }),
  ).toBeVisible();
  await expectSolid(ficha);
  await shot(cliente, "2_equipamento");
  await ficha.getByText("Manutenção do split da recepção").click();
  const atendimento = cliente.getByRole("dialog", {
    name: "Manutenção do split da recepção",
  });
  await expect(atendimento.getByText("Documentos")).toBeVisible();
  await expectSolid(atendimento);
  await shot(cliente, "3_atendimento");

  assertClean(recorder, "fichas do portal");
  await contexto.close();
});
