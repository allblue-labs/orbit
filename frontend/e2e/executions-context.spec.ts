/**
 * Onde cada execução é encontrada.
 *
 * O produto tem três execuções distintas, e elas não se confundem:
 *
 * - `PmocEquipmentExecution` — por equipamento, dentro de uma execução do plano;
 * - `RvtExecution` — por ocorrência, dentro de uma configuração;
 * - `ArtifactExecution` — o preenchimento de um artefato, que pode vir de uma
 *   operação, de um RVT ou de nada além de si.
 *
 * O que se prova aqui é que as duas primeiras são alcançadas dentro do pai, e
 * que a terceira preserva o vínculo quando ele vem na URL.
 */
import { expect, test, type Page } from "@playwright/test";

import {
  coverAsset,
  provisionOperationWithArtifact,
  provisionPmocPlan,
  provisionRvtVisit,
} from "./provision";
import { assertClean, login, record, settled } from "./support";

/**
 * Uma leitura pelo BFF, com a sessão do navegador.
 *
 * O proxy exige metadados de origem — `sec-fetch-site: same-origin` — e recusa
 * com `FORBIDDEN_ORIGIN` quem não os manda. É a proteção contra requisição
 * disparada de outra página, e o teste manda exatamente o que o navegador
 * mandaria em vez de contorná-la.
 */
async function bff(page: Page, path: string) {
  const origin = new URL(page.url()).origin;
  return page.request.get(path, {
    headers: {
      Origin: origin,
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
    },
  });
}

/**
 * Abre o primeiro **registro** da listagem e devolve a URL do detalhe.
 *
 * O href precisa terminar em um id, e não apenas começar com a base. Sem esse
 * recorte, qualquer sub-rota estática da própria tela entrava na conta — foi o
 * que aconteceu quando o PMOC ganhou um link para `/pmoc/unidades` no
 * cabeçalho: ele vem antes das linhas no DOM, era ele o "primeiro registro", e
 * o teste ficava esperando um detalhe que nunca ia abrir.
 */
async function openFirst(page: Page, base: string): Promise<string | null> {
  await page.goto(base);
  await page.waitForLoadState("networkidle").catch(() => {});

  const ehDetalhe = new RegExp(`^${base}/[0-9a-f-]{36}$`);
  for (const candidato of await page.locator(`a[href^="${base}/"]`).all()) {
    const href = (await candidato.getAttribute("href")) ?? "";
    if (!ehDetalhe.test(href)) continue;
    await candidato.click();
    await page.waitForURL(new RegExp(`${base}/[0-9a-f-]{36}`), {
      timeout: 20_000,
    });
    return new URL(page.url()).pathname;
  }
  return null;
}

test("as execuções do PMOC são vistas dentro do plano", async ({ page }) => {
  const recorder = record(page);
  await login(page);

  const detail = await openFirst(page, "/pmoc");
  expect(detail, "nenhum plano PMOC na listagem").not.toBeNull();

  await expect(page.getByRole("tab", { name: "Execuções" })).toBeVisible();
  await page.getByRole("tab", { name: "Execuções" }).click();

  /** A seção é da execução selecionada — a granularidade é o equipamento. */
  const section = page.locator(
    'section[aria-label="Equipamentos desta execução"]',
  );
  await expect(section).toBeVisible({ timeout: 20_000 });

  /** O contexto do plano não é pedido de novo: a URL continua a do plano. */
  expect(new URL(page.url()).pathname).toBe(detail);

  assertClean(recorder, "execuções do PMOC");
});

test("as consultas do PMOC são recortadas pelo servidor, por plano e execução", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);

  const scoped: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/equipment-executions$/.test(path)) scoped.push(path);
  });

  const detail = await openFirst(page, "/pmoc");
  expect(detail).not.toBeNull();
  const planId = detail!.split("/").pop()!;

  await page.getByRole("tab", { name: "Execuções" }).click();
  await expect(
    page.locator('section[aria-label="Equipamentos desta execução"]'),
  ).toBeVisible({ timeout: 20_000 });

  /** Nada de buscar tudo e filtrar no navegador: plano e execução vão na rota. */
  expect(scoped.length).toBeGreaterThan(0);
  for (const path of scoped) {
    expect(path).toContain(`/pmoc/plans/${planId}/cycles/`);
  }

  assertClean(recorder, "recorte do PMOC");
});

test("as visitas do RVT são vistas dentro da configuração", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);

  const detail = await openFirst(page, "/rvt");
  expect(detail, "nenhuma configuração RVT na listagem").not.toBeNull();

  await expect(page.getByRole("tab", { name: "Visitas" })).toBeVisible();
  await page.getByRole("tab", { name: "Visitas" }).click();

  /**
   * As ocorrências vêm embutidas no detalhe: abrir a aba não dispara uma
   * segunda consulta que pudesse discordar da primeira.
   */
  const calls: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/api\/orbit\/rvt\//.test(path)) calls.push(path);
  });
  await page.waitForTimeout(1_500);
  expect(calls).toEqual([]);

  expect(new URL(page.url()).pathname).toBe(detail);

  assertClean(recorder, "visitas do RVT");
});

test("a execução de um RVT abre na rota do próprio RVT", async ({ page }) => {
  const recorder = record(page);
  await login(page);

  /**
   * A visita é do cenário. Antes ele abria a primeira configuração da lista e
   * se pulava quando aquela não tinha visita executada — um cenário
   * obrigatório que não provava nada quando o tenant não colaborava.
   */
  const visit = await provisionRvtVisit(page, "contexto");
  await page.goto(`/rvt/${visit.configurationId}`);
  await page.getByRole("tab", { name: "Visitas" }).click();

  const link = page.locator(`a[href="/rvt/execucoes/${visit.executionId}"]`);
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();
  await page.waitForURL(/\/rvt\/execucoes\/[0-9a-f-]{36}/, { timeout: 20_000 });

  /** O contexto pai está na própria rota — não é uma superfície global. */
  expect(new URL(page.url()).pathname).toMatch(/^\/rvt\/execucoes\//);

  assertClean(recorder, "execução do RVT");
});

/**
 * A listagem global de execuções não existe mais.
 *
 * Os dois casos que viviam aqui — o recorte por ativo na URL e a visão geral
 * sem recorte — testavam uma superfície que a PR-FX-01 removeu: uma entrada de
 * produto para um conceito de arquitetura. O que sobrevive, e continua coberto
 * abaixo, é o acesso **contextual**: a execução vista de dentro da operação,
 * do PMOC e da visita técnica.
 */
test("a rota global leva ao Centro de Documentos", async ({ page }) => {
  const recorder = record(page);
  await login(page);

  await page.goto("/execucoes?assetId=01a057ee-cfda-72de-9874-63bb83b988d8");
  await page.waitForLoadState("networkidle").catch(() => {});

  /**
   * Redireciona em vez de 404: o caminho continua alcançável por favorito e
   * histórico, e o que a pessoa procurava existe com outro nome.
   */
  await expect(page).toHaveURL(/\/documentos$/);

  assertClean(recorder, "rota global redirecionada");
});

test("a navegação nomeia os domínios, e não a arquitetura", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/dashboard");

  const nav = page.locator("nav").first();

  /**
   * PMOC e RVT continuam nomeados, agora como **abas** de Operações.
   *
   * Eram itens de menu quando este teste nasceu. O que ele mede não mudou — a
   * navegação chama o trabalho pelo nome que a pessoa usa —, mudou onde os nomes
   * aparecem: os três são o mesmo assunto visto de três ângulos, e quem trabalha
   * neles alterna entre os três no mesmo dia.
   */
  await expect(nav.getByRole("link", { name: "Documentos" })).toBeVisible();

  await page.goto("/operacoes");
  await settled(page);
  for (const dominio of ["PMOC", "RVT"]) {
    await expect(
      page.getByRole("tab", { name: dominio, exact: true }),
    ).toBeVisible();
  }

  /** "Execuções de artefato" era o nome do modelo, não o do trabalho. */
  await expect(
    nav.getByRole("link", { name: "Execuções de artefato" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("tab", { name: "Execuções de artefato" }),
  ).toHaveCount(0);

  assertClean(recorder, "navegação");
});

/* ------------------------------------------------------------------ */
/* Operação — a superfície contextual da H04.1                          */
/* ------------------------------------------------------------------ */

/**
 * Duas operações, cada uma com a sua execução de artefato.
 *
 * Antes o cenário garimpava, entre as sessenta execuções mais recentes, duas
 * que tivessem operação — e se pulava quando não achava. Um cenário
 * obrigatório que se pula não prova nada. Agora o vínculo é criado aqui, e o
 * teste sabe exatamente o que espera ver em cada operação.
 */
async function twoOperationsWithExecutions(page: Page) {
  const a = await provisionOperationWithArtifact(page, "ctx-a");
  const b = await provisionOperationWithArtifact(page, "ctx-b");
  return { a, b };
}

test("a operação mostra as suas execuções de artefato, e só as suas", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);

  const { a: operationA, b: operationB } =
    await twoOperationsWithExecutions(page);

  const scoped: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.endsWith("/artifact-executions") &&
      url.searchParams.get("operationId")
    ) {
      scoped.push(url.searchParams.get("operationId")!);
    }
  });

  await page.goto(`/operacoes/${operationA.id}`);
  await page.waitForLoadState("networkidle").catch(() => {});

  const panel = page.locator('[data-panel="operation-artifact-executions"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });

  /** O que é desta operação aparece. */
  await expect(panel).toContainText(operationA.executionCode);
  /** O que é de outra, não. */
  await expect(panel).not.toContainText(operationB.executionCode);

  /** O recorte foi decidido no servidor, não aqui. */
  expect(scoped).toContain(operationA.id);

  assertClean(recorder, "execuções de artefato da operação");
});

test("a operação não oferece um “Ver tudo” que não existe", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);

  const { a: operationA } = await twoOperationsWithExecutions(page);

  await page.goto(`/operacoes/${operationA.id}`);
  const panel = page.locator('[data-panel="operation-artifact-executions"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });

  /**
   * O painel mostra as execuções desta operação e para por aí. Sem a listagem
   * global, um "Ver tudo" levaria a uma lista sem o filtro — que pareceria um
   * recorte que silenciosamente não valeu.
   */
  await expect(panel.getByRole("link", { name: /Ver tudo/i })).toHaveCount(0);

  assertClean(recorder, "painel sem ver tudo");
});

test("a execução abre pela rota canônica do artefato", async ({ page }) => {
  const recorder = record(page);
  await login(page);

  const { a: operationA } = await twoOperationsWithExecutions(page);

  await page.goto(`/operacoes/${operationA.id}`);
  const panel = page.locator('[data-panel="operation-artifact-executions"]');
  await expect(panel).toBeVisible({ timeout: 20_000 });

  /** O código fica na linha de apoio; o link é o título, na mesma linha da lista. */
  await panel
    .getByRole("listitem")
    .filter({ hasText: operationA.executionCode })
    .getByRole("link")
    .click();
  await page.waitForURL(new RegExp(`/execucoes/${operationA.executionId}`), {
    timeout: 20_000,
  });

  assertClean(recorder, "detalhe da execução");
});

test("execuções de artefato e checklists continuam seções distintas", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);

  const { a: operationA } = await twoOperationsWithExecutions(page);

  await page.goto(`/operacoes/${operationA.id}`);
  await expect(
    page.locator('[data-panel="operation-artifact-executions"]'),
  ).toBeVisible({ timeout: 20_000 });
  /** `ChecklistExecution` é outro conceito, e continua no seu lugar. */
  await expect(
    page.locator('[data-panel="operation-checklists"]'),
  ).toBeVisible();

  assertClean(recorder, "seções distintas");
});

/* ------------------------------------------------------------------ */
/* PMOC — a elegibilidade no Read Model                                 */
/* ------------------------------------------------------------------ */

test("a lista da execução não pede uma preparação por equipamento", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);

  const preparations: string[] = [];
  const lists: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/execution-preparation$/.test(path)) preparations.push(path);
    if (/equipment-executions$/.test(path)) lists.push(path);
  });

  await openFirst(page, "/pmoc");
  await page.getByRole("tab", { name: "Execuções" }).click();
  const section = page.locator(
    'section[aria-label="Equipamentos desta execução"]',
  );
  await expect(section).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(2_000);

  /** Uma consulta traz a lista inteira, disponibilidade incluída. */
  expect(lists.length).toBeGreaterThan(0);
  /** E nenhuma requisição por linha só para desenhar a disponibilidade. */
  expect(preparations).toEqual([]);

  assertClean(recorder, "execução sem N+1");
});

test("a disponibilidade da lista concorda com a preparação canônica", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);

  /**
   * O plano é do cenário, e nasce com cobertura: assim ele tem execução e tem
   * linha de equipamento, que é o que a paridade compara. Antes abria o
   * primeiro plano da listagem e se pulava quando aquele não tinha execução.
   */
  const plan = await provisionPmocPlan(page, "paridade", 2);
  await coverAsset(page, plan.id, plan.assets[0].id);
  const planId = plan.id;

  const cycles = await bff(page, `/api/orbit/pmoc/plans/${planId}/executions`);
  expect(cycles.ok()).toBe(true);
  const cycleBody = await cycles.json();
  const cycleId = (cycleBody.data?.data ?? cycleBody.data ?? [])[0]?.id as
    string | undefined;
  expect(
    cycleId,
    "o plano ativado precisa ter uma execução aberta",
  ).toBeTruthy();

  const listResponse = await bff(
    page,
    `/api/orbit/pmoc/plans/${planId}/cycles/${cycleId}/equipment-executions`,
  );
  expect(listResponse.ok()).toBe(true);
  const rows = (await listResponse.json()).data as Array<{
    equipment: { id: string };
    eligibility: { ready: boolean; blockedReasons: string[] };
  }>;
  expect(rows.length).toBeGreaterThan(0);

  /** Toda linha publica a disponibilidade — não é um campo opcional na prática. */
  for (const row of rows) expect(row.eligibility).toBeTruthy();

  /**
   * Mesma regra, duas leituras: a da lista e a da preparação canônica têm de
   * dizer a mesma coisa sobre o mesmo equipamento no mesmo estado.
   */
  const sample = rows[0];
  const preparation = await bff(
    page,
    `/api/orbit/pmoc/plans/${planId}/cycles/${cycleId}/equipment/${sample.equipment.id}/execution-preparation`,
  );
  expect(preparation.ok()).toBe(true);
  const canonical = (await preparation.json()).data.eligibility;
  expect(sample.eligibility).toEqual(canonical);

  assertClean(recorder, "paridade da disponibilidade");
});
