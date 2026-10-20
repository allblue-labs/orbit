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
 * confere isso pela API antes de abrir o navegador e se pula com a razão exata —
 * um cenário incompleto reprovando parece defeito da tela.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

import { OWNER, login, record, settled } from "./support";

const API = process.env.ORBIT_API_URL ?? "http://localhost:6001/api/v1";

interface Scenario {
  readonly planId: string;
  readonly cycleId: string;
  readonly assetId: string;
  readonly equipmentName: string;
  /** Vazio quando o cenário está pronto; a razão quando não está. */
  readonly blocker: string;
}

async function scenario(request: APIRequestContext): Promise<Scenario> {
  const auth = await request.post(`${API}/identity/login`, {
    data: { email: OWNER.email, password: OWNER.password },
  });
  const token = (await auth.json()).data.accessToken as string;
  const headers = { authorization: `Bearer ${token}` };

  const vazio = {
    planId: "",
    cycleId: "",
    assetId: "",
    equipmentName: "",
  };

  const planos = await request.get(`${API}/pmoc/plans?status=ACTIVE&limit=1`, {
    headers,
  });
  const pagina = (await planos.json()).data;
  const plano = (Array.isArray(pagina?.data) ? pagina.data : [])[0];
  if (!plano) return { ...vazio, blocker: "nenhum plano de PMOC ativo" };

  const ciclos = await request.get(`${API}/pmoc/plans/${plano.id}/executions`, {
    headers,
  });
  const ciclo = ((await ciclos.json()).data ?? [])[0];
  if (!ciclo)
    return { ...vazio, blocker: "o plano ativo não tem ciclo aberto" };

  /*
   * O equipamento é **deste** teste.
   *
   * Reaproveitar um do plano torna a execução única: aberta uma vez, `START`
   * desaparece e a rodada seguinte se pula. Foi o que aconteceu na primeira
   * tentativa — e um teste que só passa na primeira execução não é teste.
   *
   * De brinde, exercita o caso que justifica a contagem por equipamento: uma
   * máquina que entra no contrato com o ciclo já aberto está na sua **primeira**
   * manutenção dentro de um ciclo que pode ser o sétimo.
   */
  const marca = `E2E-${Date.now()}`;
  const unidade = await request.get(`${API}/organizations/current`, {
    headers,
  });
  const businessUnitId = (await unidade.json()).data.businessUnits[0]
    .id as string;

  const criado = await request.post(`${API}/assets`, {
    headers,
    data: {
      name: `Split ${marca}`,
      category: "EQUIPMENT",
      identifierType: "INTERNAL_CODE",
      identifier: marca,
      location: "Sala de teste",
      businessUnitId,
    },
  });
  expect(criado.ok(), await criado.text()).toBe(true);
  const assetId = (await criado.json()).data.id as string;

  const vinculado = await request.post(
    `${API}/pmoc/plans/${plano.id}/equipment`,
    { headers, data: { assetId } },
  );
  expect(vinculado.ok(), await vinculado.text()).toBe(true);

  const cobertura = { asset: { id: assetId, name: `Split ${marca}` } };

  /* A preparação é a autoridade: ela já cruzou as cinco pré-condições. */
  const preparacao = await request.get(
    `${API}/pmoc/plans/${plano.id}/cycles/${ciclo.id}/equipment/${cobertura.asset.id}/execution-preparation`,
    { headers },
  );
  const prep = (await preparacao.json()).data;
  const pronto =
    prep?.eligibility?.ready === true &&
    (prep?.allowedActions ?? []).includes("START");

  return {
    planId: plano.id,
    cycleId: ciclo.id,
    assetId: cobertura.asset.id,
    equipmentName: cobertura.asset.name,
    blocker: pronto
      ? ""
      : `a execução não está liberada: ${JSON.stringify(prep?.eligibility?.blockedReasons ?? prep?.allowedActions)}`,
  };
}

test("o atendimento vai de aberto a relatório emitido", async ({
  page,
  request,
}) => {
  const cenario = await scenario(request);
  test.skip(cenario.blocker.length > 0, cenario.blocker);

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
  await dialogo.getByRole("button", { name: /Registrar manutenção/i }).click();
  await settled(page);

  /* Passo 4 — emitir. Concluir não emite: são duas decisões. */
  const emitir = dialogo.getByRole("button", { name: /Emitir relatório/i });
  await expect(emitir).toBeVisible();
  await emitir.click();
  await settled(page);

  await expect(dialogo.getByText(/Relatório emitido/i)).toBeVisible();
  await expect(
    dialogo.getByRole("link", { name: /Abrir o documento/i }),
  ).toBeVisible();

  expect(recorder.pageErrors, "exceções não tratadas").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React").toEqual([]);
  expect(
    recorder.consoleErrors.filter((erro) => !/403 \(Forbidden\)/.test(erro)),
    "console.error além do 403 esperado",
  ).toEqual([]);
});
