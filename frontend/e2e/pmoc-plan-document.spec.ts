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

/**
 * Uma conta com `pmoc.read` e **sem** `pmoc.manage`.
 *
 * É a conta que prova a correção: o componente de ações começava com
 * `if (!canManage) return null`, e quem só consulta o plano perdia o contrato
 * impresso — um documento que o servidor entrega a `pmoc.read`.
 *
 * Sem ela o teste passa com o botão de volta atrás do portão, porque o dono tem
 * as duas permissões. Foi o que aconteceu na primeira tentativa.
 */
const VIEWER = {
  email: process.env.ORBIT_VIEWER_EMAIL ?? "viewer.pmoc@orbit.test",
  password: process.env.ORBIT_VIEWER_PASSWORD ?? "",
};

async function loginAs(
  page: import("@playwright/test").Page,
  quem: { email: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(quem.email);
  await page.getByLabel(/senha/i).first().fill(quem.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL(/\/(dashboard|)$/, { timeout: 30_000 });
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
  test.skip(
    VIEWER.password.length === 0,
    "sem ORBIT_VIEWER_PASSWORD não há conta de leitura para exercitar",
  );

  const planId = await seedPlan(request);

  await loginAs(page, VIEWER);
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
