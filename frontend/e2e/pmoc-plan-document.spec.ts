/**
 * Baixar o contrato de PMOC pela página.
 *
 * ## Por que no navegador
 *
 * A rota já existia e sempre respondeu — o que faltava era a porta. Um teste de
 * unidade provaria que o componente renderiza um botão; não provaria que o botão
 * chega a quem tem direito a ele nem que o arquivo desce.
 *
 * O ponto que mais importa aqui é **quem** vê o botão: o relatório de
 * configuração exige `pmoc.read`, e o componente de ações começava com
 * `if (!canManage) return null`. Quem só consulta o plano perdia um documento que
 * o servidor entrega.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

import { OWNER, login, record, settled } from "./support";

/** Membro real de leitura, criado sem depender de credenciais externas. */
async function provisionViewer(request: APIRequestContext) {
  const auth = await request.post(`${API}/identity/login`, {
    data: OWNER,
  });
  expect(auth.ok(), await auth.text()).toBe(true);
  const headers = {
    authorization: `Bearer ${(await auth.json()).data.accessToken}`,
  };
  const rolesResponse = await request.get(
    `${API}/organizations/current/roles`,
    { headers },
  );
  expect(rolesResponse.ok(), await rolesResponse.text()).toBe(true);
  const roles = (await rolesResponse.json()).data as {
    id: string;
    key: string;
  }[];
  const role = roles.find((item) => item.key === "VIEWER");
  expect(role, "papel de consulta deve existir").toBeTruthy();
  const email = `pmoc.viewer.${crypto.randomUUID()}@orbit.local`;
  const created = await request.post(
    `${API}/organizations/current/team/members`,
    {
      headers,
      data: { email, firstName: "Leitura", lastName: "PMOC", roleId: role!.id },
    },
  );
  expect(created.ok(), await created.text()).toBe(true);
  const { temporaryPassword } = (await created.json()).data;
  const session = await request.post(`${API}/identity/login`, {
    data: { email, password: temporaryPassword },
  });
  expect(session.ok(), await session.text()).toBe(true);
  const password = "Pmoc#Consulta@2026";
  const changed = await request.post(`${API}/identity/me/password`, {
    headers: {
      authorization: `Bearer ${(await session.json()).data.accessToken}`,
    },
    data: { currentPassword: temporaryPassword, newPassword: password },
  });
  expect(changed.status(), await changed.text()).toBe(204);
  return { email, password };
}

async function loginAs(
  page: import("@playwright/test").Page,
  quem: { email: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(quem.email);
  await page.getByLabel(/senha/i).first().fill(quem.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(dashboard|)$/, { timeout: 30_000 });
  const guide = page.getByRole("dialog", { name: "Seu espaço começa aqui" });
  await guide.getByRole("button", { name: "Pular e fazer depois" }).click();
  await expect(guide).toHaveCount(0);
}

const API = process.env.ORBIT_API_URL ?? "http://localhost:6001/api/v1";

/** O plano que a página vai abrir. Criado aqui para o teste não depender de sobra. */
async function seedPlan(request: APIRequestContext): Promise<string> {
  const auth = await request.post(`${API}/identity/login`, {
    data: { email: OWNER.email, password: OWNER.password },
  });
  const token = (await auth.json()).data.accessToken as string;
  const headers = { authorization: `Bearer ${token}` };

  const existentes = await request.get(`${API}/pmoc/plans?limit=1`, {
    headers,
  });
  const pagina = (await existentes.json()).data;
  const encontrado = Array.isArray(pagina?.data) ? pagina.data[0] : undefined;
  expect(
    encontrado,
    "o inquilino precisa de ao menos um plano de PMOC",
  ).toBeTruthy();
  return encontrado.id as string;
}

test("a página do plano baixa o contrato em PDF", async ({ page, request }) => {
  const planId = await seedPlan(request);
  const recorder = record(page);

  await login(page);
  await page.goto(`/pmoc/${planId}`);
  await settled(page);

  const baixar = page.getByRole("button", { name: /Baixar contrato/i });
  await expect(baixar).toBeVisible();

  const arquivo = page.waitForEvent("download");
  await baixar.click();

  /* O nome vem do `Content-Disposition`: é o servidor que decide como o
     documento se chama, e montá-lo no cliente duplicaria essa regra. */
  expect((await arquivo).suggestedFilename()).toMatch(/\.pdf$/);

  expect(recorder.pageErrors, "exceções não tratadas").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React").toEqual([]);
  expect(
    recorder.consoleErrors.filter((erro) => !/403 \(Forbidden\)/.test(erro)),
    "console.error além do 403 esperado",
  ).toEqual([]);
});

test("quem só consulta o plano também baixa o contrato", async ({
  page,
  request,
}) => {
  const viewer = await provisionViewer(request);

  const planId = await seedPlan(request);

  await loginAs(page, viewer);
  await page.goto(`/pmoc/${planId}`);
  await settled(page);

  /*
   * O contrato exige `pmoc.read`; editar e mudar de estado exigem
   * `pmoc.manage`. É a distinção que o portão apagava.
   */
  await expect(
    page.getByRole("button", { name: /Baixar contrato/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Editar$/ })).toHaveCount(0);

  const arquivo = page.waitForEvent("download");
  await page.getByRole("button", { name: /Baixar contrato/i }).click();
  expect((await arquivo).suggestedFilename()).toMatch(/\.pdf$/);
});
