/**
 * RVT V2 no navegador.
 *
 * O que estes testes provam é a separação que o domínio mantém e a tela
 * precisa ensinar:
 *
 * ```text
 * configuração ≠ ocorrência ≠ execução ≠ documento
 * ```
 *
 * Os RVTs avulsos usados aqui nasceram pelo caminho real do aplicativo de
 * campo (`POST /rvt/ad-hoc/executions`), não por fixture da UI: é assim que o
 * backend os canonicaliza, e é assim que o Web precisa mostrá-los.
 *
 * A suíte roda em série e compartilha o tenant; cada teste que cria algo usa
 * um código próprio, como aconteceria com duas pessoas usando o produto.
 */
import { expect, test } from "@playwright/test";
import { OWNER, assertClean, login, record, settled } from "./support";

test.describe.configure({ mode: "serial" });

const stamp = () => Date.now().toString().slice(-6);

/** Abre a lista de RVT já autenticado. */
async function openRvt(page: import("@playwright/test").Page) {
  await page.goto("/rvt");
  await settled(page);
}

/**
 * Cria uma configuração pela UI e devolve o código usado.
 *
 * O formulário é o do produto — nada é enviado por API aqui, porque o que se
 * prova é justamente que a criação administrativa funciona pela tela.
 */
async function createConfiguration(
  page: import("@playwright/test").Page,
  options: { mode: string; type: string; name: string; recurring: boolean },
): Promise<{ code: string; name: string }> {
  const code = `RVT-FE04-${stamp()}`;
  await page
    .getByRole("button", { name: /Nova visita técnica/ })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();

  await dialog.getByLabel("Código").fill(code);
  await dialog.getByLabel("Nome").fill(options.name);

  await dialog.getByLabel("Agenda").click();
  await page.getByRole("option", { name: options.mode, exact: true }).click();

  /*
    "Tipo de manutenção", e a opção traz a cadência junto.

    O ritmo deixou de ser um literal de dois valores traduzido no cliente: é
    cadastro da organização, e o seletor mostra "Semanal · a cada 7 dias" para
    quem contrata saber o que está contratando.
  */
  await dialog.getByLabel("Tipo de manutenção").click();
  await page
    .getByRole("option", { name: new RegExp(`^${options.type} · `) })
    .click();

  await dialog.getByLabel("Início da vigência").fill("2026-09-07");
  if (options.recurring) {
    await dialog.getByLabel("Fim da vigência").fill("2026-11-30");
  }
  await dialog.getByLabel("Local do serviço").fill("Recife");

  await dialog.getByRole("button", { name: "Criar visita técnica" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await settled(page);
  return { code, name: options.name };
}

/**
 * Abre o detalhe pelo link da lista — o código é texto, não navegação.
 *
 * A espera é pela URL, não por `networkidle`: a navegação é do cliente e a
 * rede fica ociosa antes de a rota trocar.
 */
async function openConfiguration(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.getByRole("link", { name, exact: true }).click();
  await page.waitForURL(/\/rvt\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await settled(page);
}

/**
 * Troca de aba e espera o painel aparecer.
 *
 * O clique pode chegar antes de a React assumir o HTML servido: o elemento já
 * está lá e é clicável, mas ainda não escuta. Repetir até o painel abrir é o
 * que separa "a aba não funciona" de "a página ainda não tinha hidratado".
 */
async function openTab(page: import("@playwright/test").Page, name: string) {
  await expect(async () => {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tabpanel", { name })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 20_000 });
  await settled(page);
}

/**
 * Abre a execução da primeira visita de uma configuração, pelo caminho que o
 * usuário faz: lista → configuração → aba de visitas → execução.
 */
async function openExecutionOf(
  page: import("@playwright/test").Page,
  configuration: RegExp,
) {
  await openRvt(page);
  await page.getByRole("link", { name: configuration }).click();
  await page.waitForURL(/\/rvt\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await settled(page);
  await openTab(page, "Visitas");
  await page.getByRole("link", { name: "Abrir visita" }).first().click();
  await page.waitForURL(/\/rvt\/execucoes\//, { timeout: 20_000 });
  await settled(page);
}

/**
 * Os RVTs avulsos que os testes de execução leem.
 *
 * Criados pelo **caminho real do aplicativo de campo**
 * (`POST /rvt/ad-hoc/executions`), não por fixture de UI: é assim que o
 * backend canonicaliza um RVT avulso, e é isso que o Web precisa mostrar. São
 * criados a cada corrida, com nome próprio, porque a lista do backend devolve
 * as mais recentes e não oferece busca — depender de dado semeado à mão faria
 * a suíte apodrecer junto com o banco.
 */
const SEEDED = {
  withDocument: `Visita avulsa — auditoria ${stamp()}`,
  withoutAcknowledgement: `Visita avulsa — sem aceite ${stamp()}`,
};

test.beforeAll(async ({ request }) => {
  const api = process.env.ORBIT_API_URL ?? "http://localhost:6001/api/v1";

  const session = await request.post(`${api}/identity/login`, {
    data: { email: OWNER.email, password: OWNER.password },
  });
  const token = (await session.json()).data.accessToken as string;
  const headers = { authorization: `Bearer ${token}` };

  const context = await request.get(`${api}/organizations/current`, {
    headers,
  });
  const unit = (await context.json()).data.businessUnits[0].id as string;

  /**
   * Cliente e equipamentos próprios, na mesma unidade das visitas.
   *
   * O seed pegava `customers?limit=1` e `assets?limit=4` — os primeiros do
   * tenant. Quando outro cenário passou a criar clientes e equipamentos, os
   * primeiros passaram a ser de outra unidade e o servidor recusava a criação
   * com `BUSINESS_UNIT_SCOPE_INVALID`. Criando os seus, o cenário sabe que
   * cliente, equipamentos e visita estão no mesmo escopo.
   */
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

  const customer = await request.post(`${api}/customers`, {
    headers,
    data: { type: "COMPANY", legalName: `Cenário RVT ${suffix}` },
  });
  expect(customer.ok(), await customer.text()).toBe(true);
  const customerId = (await customer.json()).data.id as string;

  const ids: string[] = [];
  for (let index = 1; index <= 4; index += 1) {
    const asset = await request.post(`${api}/assets`, {
      headers,
      data: {
        businessUnitId: unit,
        customerId,
        category: "EQUIPMENT",
        name: `Equipamento RVT ${index} ${suffix}`,
      },
    });
    expect(asset.ok(), await asset.text()).toBe(true);
    ids.push((await asset.json()).data.id as string);
  }

  /** O tipo semanal desta organização — o ritmo virou cadastro, não literal. */
  const tipos = await request.get(`${api}/rvt/maintenance-types`, { headers });
  expect(tipos.ok(), await tipos.text()).toBe(true);
  const maintenanceTypeId = (
    (await tipos.json()).data as { id: string; key: string }[]
  ).find((tipo) => tipo.key === "WEEKLY")!.id;

  const adHoc = async (name: string, equipmentIds: string[]) => {
    const created = await request.post(`${api}/rvt/ad-hoc/executions`, {
      headers: {
        ...headers,
        "idempotency-key": `fe04-${name.replace(/[^a-zA-Z0-9]/g, "-")}`,
      },
      data: {
        businessUnitId: unit,
        customerId,
        name,
        maintenanceTypeId,
        timezone: "America/Recife",
        serviceLocation: { city: "Recife" },
        procedure: { items: [] },
        equipmentIds,
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    return (await created.json()).data.execution.id as string;
  };

  /** Três equipamentos: é o caso que prova a visita multi-equipamento. */
  const complete = await adHoc(SEEDED.withDocument, ids.slice(0, 3));
  await request.patch(`${api}/rvt/executions/${complete}`, {
    headers,
    data: {
      observations: [
        { item: "Filtro de ar", condição: "Saturado", ação: "Substituído" },
      ],
      recommendations: [
        { item: "Compressor", prazo: "30 dias", descrição: "Trocar capacitor" },
      ],
      freeTextRecommendation:
        "Recomenda-se antecipar a próxima visita, dado o regime de operação contínua.",
    },
  });
  /**
   * Um arquivo real, pelo caminho real de upload.
   *
   * Evidência e aceite exigem um `storageFileId` **disponível**, e o backend
   * confere o objeto: reservar, enviar os bytes e confirmar é o que o
   * aplicativo de campo faz. Fabricar a linha no banco pularia justamente a
   * verificação que dá sentido ao dado.
   */
  const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const reservation = await request.post(
    `${api}/mobile/field/me/signature/uploads`,
    {
      headers,
      data: {
        fileName: "fe04-evidencia.png",
        mimeType: "image/png",
        sizeBytes: PNG.length,
      },
    },
  );
  expect(reservation.ok(), await reservation.text()).toBe(true);
  const reserved = (await reservation.json()).data as {
    fileId: string;
    upload: { url: string; requiredHeaders?: Record<string, string> };
  };
  await request.put(reserved.upload.url, {
    headers: { ...(reserved.upload.requiredHeaders ?? {}) },
    data: PNG,
  });
  const confirmed = await request.post(`${api}/mobile/field/me/signature`, {
    headers,
    data: { storageObjectId: reserved.fileId },
  });
  expect(confirmed.ok(), await confirmed.text()).toBe(true);
  const signatureFileId = reserved.fileId;

  await request.post(`${api}/rvt/executions/${complete}/evidence`, {
    headers,
    data: {
      storageFileId: signatureFileId,
      assetId: ids[0],
      kind: "PHOTO",
      caption: "Filtro saturado antes da limpeza",
    },
  });
  const acknowledged = await request.post(
    `${api}/rvt/executions/${complete}/customer-acknowledgement`,
    {
      headers,
      data: {
        name: "Marina Alves — Facilities",
        storageFileId: signatureFileId,
      },
    },
  );
  expect(acknowledged.ok(), await acknowledged.text()).toBe(true);

  const finished = await request.post(
    `${api}/rvt/executions/${complete}/complete`,
    { headers, data: {} },
  );
  expect(finished.ok(), await finished.text()).toBe(true);

  /** A segunda fica em campo: sem aceite e sem documento, que é estado válido. */
  await adHoc(SEEDED.withoutAcknowledgement, ids.slice(3, 4));
});

test.beforeEach(async ({ page }) => {
  await login(page);
});

/* ================================================================== */
/* Lista e vocabulário                                                 */
/* ================================================================== */

test("a lista traz configurações reais, sem enum cru na tela", async ({
  page,
}) => {
  const recorder = record(page);
  await openRvt(page);

  await expect(
    page.getByRole("heading", { name: "RVT", exact: true }),
  ).toBeVisible();
  /** As visitas avulsas semeadas pelo caminho do app de campo aparecem aqui. */
  await expect(
    page.getByRole("link", { name: new RegExp(SEEDED.withDocument) }),
  ).toBeVisible();

  /**
   * Nenhum código de domínio vaza para o usuário. É a asserção que pega a
   * regressão mais fácil de cometer: publicar um status novo e esquecer o
   * rótulo.
   */
  const body = (await page.locator("body").innerText()).toUpperCase();
  for (const raw of [
    "WEEKLY",
    "SEMIANNUAL",
    "ONE_TIME",
    "RECURRING",
    "SCHEDULED",
    "IN_PROGRESS",
    "FIELD_TECHNICIAN",
    "TECHNICAL_RESPONSIBLE",
    "RVT_EXECUTION",
  ]) {
    expect(body, `enum cru na tela: ${raw}`).not.toContain(raw);
  }

  assertClean(recorder, "/rvt");
});

test("visita avulsa é rotulada a partir do modo de agenda do servidor", async ({
  page,
}) => {
  const recorder = record(page);
  await openRvt(page);

  /** "Visita avulsa" é derivado de ONE_TIME — não é um enum de produto. */
  await expect(page.getByText("Visita avulsa").first()).toBeVisible();
  await expect(page.getByText("Uma única vez").first()).toBeVisible();

  assertClean(recorder, "avulsa");
});

/* ================================================================== */
/* Criação — as três agendas                                           */
/* ================================================================== */

test("cria configuração semanal e o servidor gera as visitas", async ({
  page,
}) => {
  const recorder = record(page);
  await openRvt(page);

  const created = await createConfiguration(page, {
    mode: "Recorrente",
    type: "Semanal",
    name: `Semanal FE04 ${stamp()}`,
    recurring: true,
  });

  await expect(page.getByText(created.code)).toBeVisible();
  await openConfiguration(page, created.name);

  await expect(
    page.getByRole("main").getByText("Semanal").first(),
  ).toBeVisible();
  await openTab(page, "Visitas");

  /**
   * Doze semanas entre 07/09 e 30/11 — mas o número não é conferido contra
   * uma conta feita aqui: o que se prova é que **o servidor** gerou mais de
   * uma visita e que a numeração é a dele.
   */
  const rows = page.getByRole("row");
  await expect(rows.nth(2)).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "001", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "002", exact: true }),
  ).toBeVisible();

  assertClean(recorder, "semanal");
});

test("cria configuração semestral, e nunca aparece '180 dias'", async ({
  page,
}) => {
  const recorder = record(page);
  await openRvt(page);

  const created = await createConfiguration(page, {
    mode: "Recorrente",
    type: "Semestral",
    name: `Semestral FE04 ${stamp()}`,
    recurring: true,
  });

  await openConfiguration(page, created.name);

  await expect(page.getByText("Semestral").first()).toBeVisible();
  /**
   * Semestre é avanço de meses civis, não uma contagem fixa de dias. Traduzir
   * a recorrência em "180 dias" seria reconstruir aqui a regra de calendário
   * que vive no backend — e errado, porque seis meses civis vão de 181 a 184
   * dias conforme a data de partida.
   */
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/180\s*dias/i);
  expect(body).not.toMatch(/\d+\s*dias/i);

  assertClean(recorder, "semestral");
});

test("cria visita única e o servidor abre a ocorrência 001", async ({
  page,
}) => {
  const recorder = record(page);
  await openRvt(page);

  const created = await createConfiguration(page, {
    mode: "Uma única vez",
    type: "Semestral",
    name: `Avulsa FE04 ${stamp()}`,
    recurring: false,
  });

  await openConfiguration(page, created.name);

  await expect(page.getByText("Visita avulsa").first()).toBeVisible();
  await openTab(page, "Visitas");

  await expect(
    page.getByRole("cell", { name: "001", exact: true }),
  ).toHaveCount(1);
  /** Uma só: agenda única não gera 002. */
  await expect(
    page.getByRole("cell", { name: "002", exact: true }),
  ).toHaveCount(0);

  assertClean(recorder, "one-time");
});

/* ================================================================== */
/* Edição e reconciliação                                              */
/* ================================================================== */

test("editar a configuração deixa o servidor reconciliar a agenda futura", async ({
  page,
}) => {
  const recorder = record(page);
  await openRvt(page);

  const created = await createConfiguration(page, {
    mode: "Recorrente",
    type: "Semanal",
    name: `Reconciliar FE04 ${stamp()}`,
    recurring: true,
  });
  await openConfiguration(page, created.name);

  await page.getByRole("button", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog");

  /** Imutáveis por decisão de domínio: aparecem como contexto, não como campo. */
  await expect(dialog.getByText(created.code)).toBeVisible();
  await expect(dialog.getByLabel("Código")).toHaveCount(0);
  await expect(dialog.getByLabel("Cliente")).toHaveCount(0);

  /** Semanal → semestral muda quais visitas devem existir. */
  await dialog.getByLabel("Tipo de manutenção").click();
  await page.getByRole("option", { name: /^Semestral · / }).click();
  await dialog.getByRole("button", { name: "Salvar" }).click();

  /**
   * O resultado é o que o **servidor** fez — criadas, remarcadas, canceladas.
   * A tela não deduz isso comparando listas, e não apaga nem recria
   * ocorrência nenhuma.
   */
  await expect(
    dialog.getByRole("heading", { name: "Visita técnica atualizada" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByLabel("Ajustes na agenda")).toBeVisible();
  await expect(
    dialog.getByText("As visitas já realizadas não foram alteradas."),
  ).toBeVisible();

  /**
   * O diálogo tem dois controles que fecham: este, no rodapé, e o "×" que o
   * primitivo desenha no canto — ambos chamados "Fechar" desde que o rótulo
   * do leitor de tela passou a ser em português. O do rodapé vem antes na
   * árvore; o "×" é renderizado depois do conteúdo.
   */
  await dialog.getByRole("button", { name: "Fechar" }).first().click();
  await settled(page);

  await page.reload();
  await settled(page);
  await expect(page.getByText("Semestral").first()).toBeVisible();

  assertClean(recorder, "reconciliação");
});

/* ================================================================== */
/* Execução                                                            */
/* ================================================================== */

test("a visita realizada mostra os equipamentos em uma consulta só", async ({
  page,
}) => {
  const recorder = record(page);
  const calls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/orbit/")) calls.push(request.url());
  });

  await openExecutionOf(page, new RegExp(SEEDED.withDocument));

  const equipment = page.getByRole("region", {
    name: "Equipamentos visitados",
  });
  await expect(equipment.getByRole("listitem")).toHaveCount(3);

  /**
   * Sem N+1: o Read Model agregado já traz os equipamentos. Uma consulta por
   * linha apareceria aqui como três chamadas a `/assets/:id`.
   */
  const perAsset = calls.filter((url) => /\/assets\/[0-9a-f-]{36}/.test(url));
  expect(perAsset, "consulta por equipamento").toEqual([]);

  assertClean(recorder, "execução");
});

test("os papéis profissionais aparecem separados, com os termos do domínio", async ({
  page,
}) => {
  const recorder = record(page);
  await openExecutionOf(page, new RegExp(SEEDED.withDocument));

  const team = page.getByRole("region", { name: "Equipe da visita" });
  await expect(
    team.getByText("Técnico em Campo", { exact: true }),
  ).toBeVisible();
  /** O termo oficial é este, em minúsculas — não "equipe técnica". */
  await expect(
    team.getByText("auxiliares técnico", { exact: true }),
  ).toBeVisible();
  await expect(
    team.getByText("Responsável Técnico", { exact: true }),
  ).toBeVisible();
  /** Um rótulo genérico apagaria a distinção que o domínio mantém. */
  await expect(team.getByText(/equipe técnica/i)).toHaveCount(0);

  /**
   * RT ausente com política que não o exige **não é falha**. O texto é
   * neutro, e nada na tela pinta alerta.
   */
  await expect(
    team.getByText("Sem Responsável Técnico nesta visita."),
  ).toBeVisible();

  assertClean(recorder, "papéis");
});

test("aceite do cliente presente aparece como instantâneo da visita", async ({
  page,
}) => {
  const recorder = record(page);
  await openExecutionOf(page, new RegExp(SEEDED.withDocument));

  const section = page.getByRole("region", { name: "Ciência do cliente" });
  await expect(section.getByText("Marina Alves — Facilities")).toBeVisible();
  /** Não é alteração cadastral do cliente, e a tela diz isso. */
  await expect(
    section.getByText(/Não altera o cadastro do cliente/),
  ).toBeVisible();

  assertClean(recorder, "aceite");
});

test("aceite ausente é estado válido, não erro", async ({ page }) => {
  const recorder = record(page);
  await openExecutionOf(page, new RegExp(SEEDED.withoutAcknowledgement));

  const section = page.getByRole("region", { name: "Ciência do cliente" });
  await expect(
    section.getByText(/A assinatura do cliente é opcional nesta visita/),
  ).toBeVisible();

  /** Sem documento também é estado normal de quem ainda está em campo. */
  const document = page.getByRole("region", { name: "Documento RVT" });
  await expect(document.getByText(/Nenhum documento emitido/)).toBeVisible();

  assertClean(recorder, "sem aceite");
});

test("evidência e recomendações pertencem à visita que as registrou", async ({
  page,
}) => {
  const recorder = record(page);
  await openExecutionOf(page, new RegExp(SEEDED.withDocument));

  const evidence = page.getByRole("region", { name: "Evidências" });
  await expect(
    evidence.getByText("Filtro saturado antes da limpeza"),
  ).toBeVisible();
  await expect(page.getByText(/antecipar a próxima visita/)).toBeVisible();

  /** A outra visita não empresta evidência nenhuma desta. */
  await openExecutionOf(page, new RegExp(SEEDED.withoutAcknowledgement));

  await expect(
    page
      .getByRole("region", { name: "Evidências" })
      .getByText("Nenhuma evidência registrada."),
  ).toBeVisible();
  await expect(page.getByText("Filtro saturado antes da limpeza")).toHaveCount(
    0,
  );

  assertClean(recorder, "isolamento de evidência");
});

test("o documento vem da execução e abre pelo visualizador canônico", async ({
  page,
}) => {
  const recorder = record(page);
  await openRvt(page);

  /** A configuração não oferece gerar documento: ela não é a fonte dele. */
  await page
    .getByRole("link", { name: new RegExp(SEEDED.withDocument) })
    .click();
  await settled(page);
  await expect(
    page.getByRole("button", { name: /Gerar documento|Gerar PDF/ }),
  ).toHaveCount(0);

  await openTab(page, "Visitas");
  await page.getByRole("link", { name: "Abrir visita" }).first().click();
  await settled(page);

  const document = page.getByRole("region", { name: "Documento RVT" });
  await expect(document.getByText("Emitido")).toBeVisible();
  await document.getByRole("button", { name: "Abrir documento" }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });

  assertClean(recorder, "documento");
});

/* ================================================================== */
/* Navegação, autorização e responsividade                             */
/* ================================================================== */

test("deep link da execução sobrevive à recarga e ao voltar", async ({
  page,
}) => {
  const recorder = record(page);
  await openRvt(page);
  await page
    .getByRole("link", { name: new RegExp(SEEDED.withDocument) })
    .click();
  await page.waitForURL(/\/rvt\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await settled(page);
  const configurationUrl = page.url();

  await openTab(page, "Visitas");
  await page.getByRole("link", { name: "Abrir visita" }).first().click();
  /** Navegação de cliente: `networkidle` volta antes de a rota trocar. */
  await page.waitForURL(/\/rvt\/execucoes\//, { timeout: 20_000 });
  await settled(page);

  await page.reload();
  await settled(page);
  await expect(
    page.getByRole("region", { name: "Equipamentos visitados" }),
  ).toBeVisible();

  await page.goBack();
  await settled(page);
  expect(page.url()).toBe(configurationUrl);

  assertClean(recorder, "deep link");
});

test("registro de outro tenant falha fechado, sem vazar existência", async ({
  page,
}) => {
  const recorder = record(page);

  /** UUIDv7 válido e inexistente neste tenant: a resposta não pode diferenciar. */
  await page.goto("/rvt/01a00000-0000-7000-8000-000000000000");
  await settled(page);

  await expect(
    page.getByText(/não está disponível|não encontrad/i).first(),
  ).toBeVisible();
  /** Nada de mensagem crua do backend em inglês. */
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/was not found|RvtConfiguration/);

  /**
   * A recusa do servidor **é** o que este teste prova — filtrá-la seria
   * apagar a evidência. O que não pode existir é qualquer outra falha por
   * trás da página de ausência.
   */
  expect(recorder.pageErrors, "exceções na ausência").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React na ausência").toEqual([]);
  expect(
    recorder.consoleErrors.filter(
      (message) => !/status of (404|400)/i.test(message),
    ),
    "console.error além da própria recusa",
  ).toEqual([]);
});

test("a lista e o detalhe seguem íntegros em 1024 e 768", async ({ page }) => {
  const recorder = record(page);

  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await openRvt(page);
    await expect(
      page.getByRole("link", { name: new RegExp(SEEDED.withDocument) }),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `estouro horizontal em ${width}px`).toBeLessThanOrEqual(0);

    await page
      .getByRole("link", { name: new RegExp(SEEDED.withDocument) })
      .click();
    await settled(page);
    await openTab(page, "Visitas");
    await page.getByRole("link", { name: "Abrir visita" }).first().click();
    await settled(page);

    const detail = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(
      detail,
      `estouro horizontal na visita em ${width}px`,
    ).toBeLessThanOrEqual(0);
  }

  assertClean(recorder, "tablet");
});
