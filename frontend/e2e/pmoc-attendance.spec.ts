/**
 * Atender um equipamento de PMOC pela web, do zero ao relatório.
 *
 * ## Por que no navegador
 *
 * As regras de passo e de payload têm teste de unidade
 * (`attendance.model.test.ts`). O que só o navegador prova é o resto — e é o que
 * faltava: que existe **porta**. A tela dizia "pronto para execução em campo" e
 * não oferecia como executar; o dono precisava do aplicativo, ou de ninguém,
 * quando o técnico faltou.
 *
 * Prova também o encadeamento das três requisições (abrir, concluir, emitir) e a
 * contagem que o relatório carrega — a do **equipamento**, não a do ciclo.
 *
 * ## O cenário é exigente
 *
 * Abrir uma execução depende de cinco pré-condições, e qualquer uma bloqueia em
 * silêncio: plano ativo, ciclo pendente, equipamento ativo, responsável técnico
 * **com assinatura**, e um técnico de campo elegível para a unidade. O teste
 * cria essas condições pela API real e exige que a preparação libere START.
 * Uma fixture incompleta deve reprovar, nunca ocultar o cenário.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

import { OWNER, login, record, settled } from "./support";
import { imageFixture } from "./image-fixture";

const API = process.env.ORBIT_API_URL ?? "http://localhost:6001/api/v1";

interface Scenario {
  readonly planId: string;
  readonly cycleId: string;
  readonly assetId: string;
  readonly equipmentName: string;
}

async function scenario(request: APIRequestContext): Promise<Scenario> {
  const auth = await request.post(`${API}/identity/login`, {
    data: { email: OWNER.email, password: OWNER.password },
  });
  expect(auth.ok(), await auth.text()).toBe(true);
  const token = (await auth.json()).data.accessToken as string;
  const headers = { authorization: `Bearer ${token}` };

  // Assinatura profissional real: reserva, upload e ativação pelo mesmo fluxo do app.
  const png = await imageFixture();
  const reservation = await request.post(
    `${API}/mobile/field/me/signature/uploads`,
    {
      headers,
      data: {
        fileName: "pmoc-tecnico.png",
        mimeType: "image/png",
        sizeBytes: png.length,
      },
    },
  );
  expect(reservation.ok(), await reservation.text()).toBe(true);
  const reserved = (await reservation.json()).data;
  const upload = await request.put(reserved.upload.url, {
    headers: reserved.upload.requiredHeaders ?? {},
    data: png,
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const signature = await request.post(`${API}/mobile/field/me/signature`, {
    headers,
    data: { storageObjectId: reserved.fileId },
  });
  expect(signature.ok(), await signature.text()).toBe(true);
  const profile = await request.get(`${API}/identity/me`, { headers });
  expect(profile.ok(), await profile.text()).toBe(true);
  const ownerId = (await profile.json()).data.id as string;

  const marca = `E2E-${Date.now()}`;
  const unidade = await request.get(`${API}/organizations/current`, {
    headers,
  });
  const businessUnitId = (await unidade.json()).data.businessUnits[0]
    .id as string;

  const customer = await request.post(`${API}/customers`, {
    headers,
    data: { type: "COMPANY", legalName: `Cliente ${marca}` },
  });
  expect(customer.ok(), await customer.text()).toBe(true);
  const customerId = (await customer.json()).data.id as string;

  const criado = await request.post(`${API}/assets`, {
    headers,
    data: {
      name: `Split ${marca}`,
      category: "EQUIPMENT",
      identifierType: "INTERNAL_CODE",
      identifier: marca,
      location: "Sala de teste",
      businessUnitId,
      customerId,
    },
  });
  expect(criado.ok(), await criado.text()).toBe(true);
  const assetId = (await criado.json()).data.id as string;

  const planResponse = await request.post(`${API}/pmoc/plans`, {
    headers,
    data: {
      businessUnitId,
      customerId,
      name: `PMOC ${marca}`,
      startsOn: new Date().toISOString().slice(0, 10),
      frequencyAmount: 1,
      frequencyUnit: "MONTHS",
      technicalResponsibleUserId: ownerId,
      technicianUserId: ownerId,
      assetIds: [assetId],
      procedure: { Evaporadora: ["Limpar filtros de ar"] },
    },
  });
  expect(planResponse.ok(), await planResponse.text()).toBe(true);
  const plano = (await planResponse.json()).data;
  const activation = await request.post(
    `${API}/pmoc/plans/${plano.id}/activate`,
    { headers, data: {} },
  );
  expect(activation.ok(), await activation.text()).toBe(true);
  const ciclos = await request.get(`${API}/pmoc/plans/${plano.id}/executions`, {
    headers,
  });
  expect(ciclos.ok(), await ciclos.text()).toBe(true);
  const ciclo = (await ciclos.json()).data[0];
  expect(ciclo, "ativar o PMOC deve abrir o primeiro ciclo").toBeTruthy();

  const cobertura = { asset: { id: assetId, name: `Split ${marca}` } };

  /* A preparação é a autoridade: ela já cruzou as cinco pré-condições. */
  const preparacao = await request.get(
    `${API}/pmoc/plans/${plano.id}/cycles/${ciclo.id}/equipment/${cobertura.asset.id}/execution-preparation`,
    { headers },
  );
  expect(preparacao.ok(), await preparacao.text()).toBe(true);
  const prep = (await preparacao.json()).data;
  const pronto =
    prep?.eligibility?.ready === true &&
    (prep?.allowedActions ?? []).includes("START");

  expect(pronto, JSON.stringify(prep?.eligibility)).toBe(true);

  return {
    planId: plano.id,
    cycleId: ciclo.id,
    assetId: cobertura.asset.id,
    equipmentName: cobertura.asset.name,
  };
}

test("o atendimento vai de aberto a relatório emitido", async ({
  page,
  request,
}) => {
  const cenario = await scenario(request);

  const recorder = record(page);

  await login(page);
  await page.goto(`/pmoc/${cenario.planId}`);
  await settled(page);

  /* A aba das execuções, onde os equipamentos do ciclo aparecem. */
  await page.getByRole("tab", { name: /Execuções/i }).click();
  await settled(page);

  const linha = page
    .getByRole("listitem")
    .filter({ hasText: cenario.equipmentName });

  /* A porta que faltava. */
  const atender = linha.getByRole("button", { name: /^Atender$/ });
  await expect(atender).toBeVisible();
  await atender.click();

  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();

  /* Passo 1 — escalar. O técnico já vem sugerido; só seguir. */
  await expect(dialogo.getByText(/Técnico em campo/i)).toBeVisible();
  await dialogo.getByRole("button", { name: /Abrir atendimento/i }).click();
  await settled(page);

  /* Passo 2 — o roteiro, lido pelo servidor a partir do JSON do plano. */
  await expect(dialogo.getByText("Evaporadora")).toBeVisible();
  await expect(dialogo.getByText("Limpar filtros de ar")).toBeVisible();

  /* A contagem é a do **equipamento**: a primeira manutenção dele no contrato. */
  await expect(dialogo.getByText(/Manutenção 1/)).toBeVisible();

  /* Avançar exige a confirmação de quem percorreu o roteiro. */
  const continuar = dialogo.getByRole("button", { name: /^Continuar$/ });
  await expect(continuar).toBeDisabled();
  await dialogo.getByRole("checkbox").check();
  await expect(continuar).toBeEnabled();
  await continuar.click();

  /* Passo 3 — registrar. Em branco, a hora é a do servidor. */
  await dialogo
    .getByLabel("Observações")
    .fill("Filtros lavados; dreno desobstruído.");
  await dialogo.getByRole("button", { name: /Revisar atendimento/i }).click();
  await expect(
    dialogo.getByText(/Confira os dados antes de concluir/),
  ).toBeVisible();
  await dialogo
    .getByRole("button", { name: /Confirmar e gerar relatório/i })
    .click();
  await expect(dialogo).toHaveCount(0);
  await expect(
    page.getByText("Atendimento de PMOC finalizado", { exact: true }),
  ).toBeVisible();

  // The document belongs to the attended equipment and remains accessible
  // after the wizard closes, even when completing it opened the next cycle.
  await expect(
    linha.getByRole("link", {
      name: "Baixar relatório de execução",
      exact: true,
    }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    linha.getByRole("button", { name: "Compartilhar relatório", exact: true }),
  ).toBeVisible();

  expect(recorder.pageErrors, "exceções não tratadas").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React").toEqual([]);
  expect(
    recorder.consoleErrors.filter((erro) => !/403 \(Forbidden\)/.test(erro)),
    "console.error além do 403 esperado",
  ).toEqual([]);
});
