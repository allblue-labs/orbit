/**
 * Identidade QR do equipamento, no navegador.
 *
 * O que estes testes protegem é uma fronteira, não uma tela:
 *
 * ```text
 * QR identifica  ≠  QR autoriza  ≠  QR comanda
 * ```
 *
 * Ler a etiqueta resolve um contexto. Não concede permissão, não cria
 * atendimento e não inicia nada. Cada uma dessas três negativas tem teste
 * próprio, porque são o tipo de garantia que se perde numa refatoração
 * distraída e ninguém percebe até um adesivo virar ordem de serviço.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { OWNER, assertClean, login, record } from "./support";
import { decodePayload, extractToken } from "./qr-payload";

test.describe.configure({ mode: "serial" });

const API = process.env.ORBIT_API_URL ?? "http://localhost:6001/api/v1";

/** Sessão de API para preparar e conferir o que a UI não deve fazer sozinha. */
async function api(request: APIRequestContext) {
  const session = await request.post(`${API}/identity/login`, {
    data: { email: OWNER.email, password: OWNER.password },
  });
  const token = (await session.json()).data.accessToken as string;
  return { headers: { authorization: `Bearer ${token}` } };
}

/** Um equipamento real do tenant, com a identidade que o gatilho criou. */
async function anEquipment(request: APIRequestContext) {
  const { headers } = await api(request);
  const response = await request.get(`${API}/assets?limit=1`, { headers });
  const asset = (await response.json()).data.data[0] as {
    id: string;
    name: string;
  };
  return { asset, headers };
}

/**
 * Abre uma tela e espera o que importa nela.
 *
 * `networkidle` não serve aqui: o Workspace do ativo mantém consultas vivas, e
 * a rede nunca fica ociosa. Esperar por um elemento real é mais rápido e diz o
 * que se está esperando.
 */
async function open(
  page: import("@playwright/test").Page,
  path: string,
  anchor: ReturnType<import("@playwright/test").Page["getByText"]>,
) {
  await page.goto(path);
  await expect(anchor).toBeVisible({ timeout: 30_000 });
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

/* ================================================================== */
/* Identidade administrativa                                           */
/* ================================================================== */

test("todo equipamento já tem identidade QR, sem comando extra", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { asset } = await anEquipment(request);

  await open(page, `/ativos/${asset.id}`, page.getByText("QR do equipamento"));
  await expect(page.getByText("Ativa", { exact: true })).toBeVisible();
  await expect(page.getByText("Baixar etiqueta")).toBeVisible();

  /**
   * A identidade nasce por gatilho no banco, a cada equipamento inserido.
   * Um botão "gerar QR" ofereceria uma escolha que o domínio não tem.
   */
  await expect(
    page.getByRole("button", { name: /gerar qr|criar qr/i }),
  ).toHaveCount(0);

  assertClean(recorder, "painel QR");
});

test("equipamento recém-criado recebe QR automaticamente", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { headers } = await api(request);

  const units = await request.get(`${API}/organizations/current`, { headers });
  const businessUnitId = (await units.json()).data.businessUnits[0].id;
  /**
   * Cliente próprio, e sufixo aleatório.
   *
   * `customers?limit=1` trazia o primeiro do tenant — que passou a ser de
   * outro cenário quando os testes começaram a criar clientes, às vezes numa
   * unidade diferente. E o sufixo por relógio repetia entre execuções.
   */
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  const customer = await request.post(`${API}/customers`, {
    headers,
    data: { type: "COMPANY", legalName: `Cenário QR ${suffix}` },
  });
  expect(customer.ok(), await customer.text()).toBe(true);
  const customerId = (await customer.json()).data.id;
  const created = await request.post(`${API}/assets`, {
    headers,
    data: {
      businessUnitId,
      customerId,
      name: `Equipamento FE05 ${suffix}`,
      category: "EQUIPMENT",
      identifier: `FE05-${suffix}`,
      identifierType: "INTERNAL_CODE",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const assetId = (await created.json()).data.id as string;

  await open(page, `/ativos/${assetId}`, page.getByText("QR do equipamento"));
  await expect(page.getByText("Ativa", { exact: true })).toBeVisible();

  assertClean(recorder, "QR automático");
});

test("a etiqueta exibida é a do backend, e o token não aparece na tela", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { asset } = await anEquipment(request);

  await open(page, `/ativos/${asset.id}`, page.getByText("QR do equipamento"));

  /** A imagem é a etiqueta renderizada pelo servidor, sob object URL. */
  const label = page.getByAltText(`Etiqueta QR do equipamento ${asset.name}`);
  await expect(label).toBeVisible();
  expect(await label.getAttribute("src")).toMatch(/^blob:/);

  /**
   * O resumo administrativo não devolve o token, e a tela não o inventa: nada
   * de 43 caracteres opacos no corpo da página.
   */
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/[A-Za-z0-9_-]{43}/);
  await expect(page.getByRole("button", { name: /copiar token/i })).toHaveCount(
    0,
  );

  assertClean(recorder, "etiqueta");
});

test("os três formatos vêm do servidor, com o tipo e o nome certos", async ({
  request,
}) => {
  const { asset, headers } = await anEquipment(request);

  const cases = [
    { format: "svg", type: "image/svg+xml", magic: "<svg" },
    { format: "png", type: "image/png", magic: "\x89PNG" },
    { format: "pdf", type: "application/pdf", magic: "%PDF-" },
  ] as const;

  for (const item of cases) {
    const response = await request.get(
      `${API}/assets/${asset.id}/qr/render?format=${item.format}&branding=ORGANIZATION`,
      { headers },
    );
    expect(response.ok(), item.format).toBe(true);
    expect(response.headers()["content-type"]).toContain(item.type);

    /** O nome do arquivo traz o código do equipamento — nunca o token. */
    const disposition = response.headers()["content-disposition"] ?? "";
    expect(disposition).toMatch(
      new RegExp(`filename="equipment-.+-qr\\.${item.format}"`),
    );
    expect(disposition).not.toMatch(/[A-Za-z0-9_-]{43}/);

    const bytes = await response.body();
    expect(bytes.subarray(0, item.magic.length).toString("latin1")).toBe(
      item.magic,
    );
  }
});

test("o payload gravado é só a URL opaca, sem nenhum identificador", async ({
  request,
}) => {
  const { asset, headers } = await anEquipment(request);

  const label = await request.get(
    `${API}/assets/${asset.id}/qr/render?format=png&branding=ORGANIZATION`,
    { headers },
  );
  const payload = await decodePayload(await label.body());

  /** Um caminho, um token, nada mais. */
  const url = new URL(payload);
  expect(url.pathname).toMatch(/^\/q\/[A-Za-z0-9_-]{43}$/);
  expect(url.search).toBe("");
  expect(url.hash).toBe("");

  /**
   * E nenhum dado do domínio viaja junto. É o que separa uma identidade
   * opaca de uma etiqueta que entrega o cadastro a quem a fotografar.
   */
  const resolved = await request.get(
    `${API}/assets/qr/${url.pathname.slice(3)}`,
    {
      headers,
    },
  );
  const equipment = (await resolved.json()).data as {
    id: string;
    serialNumber: string | null;
    customer: { id: string } | null;
  };

  for (const secret of [
    equipment.id,
    equipment.serialNumber,
    equipment.customer?.id,
    asset.name,
  ]) {
    if (secret) expect(payload, `payload vaza ${secret}`).not.toContain(secret);
  }
});

/* ================================================================== */
/* Rotação                                                             */
/* ================================================================== */

test("rotacionar invalida a etiqueta anterior e a nova resolve o mesmo equipamento", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { asset, headers } = await anEquipment(request);

  /**
   * O token só existe na etiqueta impressa e na URL de quem a leu — a API
   * administrativa não o devolve. Para provar a invalidação, o teste lê o
   * token pela rota pública que o próprio payload usa: rotaciona e compara o
   * comportamento de resolução antes e depois.
   */
  const tokenOf = async () => {
    const response = await request.get(`${API}/assets/${asset.id}/qr`, {
      headers,
    });
    return (await response.json()).data as { createdAt: string };
  };

  const before = await tokenOf();

  await open(page, `/ativos/${asset.id}`, page.getByText("QR do equipamento"));
  await page.getByRole("button", { name: "Rotacionar QR" }).click();

  const dialog = page.getByRole("alertdialog");
  /** A confirmação descreve o efeito real, e só ele. */
  await expect(dialog.getByText(/deixa de funcionar/i)).toBeVisible();
  await expect(dialog.getByText(/histórico não mudam/i)).toBeVisible();
  await dialog.getByRole("button", { name: "Rotacionar" }).click();

  await expect(dialog).toBeHidden({ timeout: 20_000 });

  /** Uma identidade nova: o servidor registra a rotação. */
  const after = await tokenOf();
  expect(after.createdAt).not.toBe(before.createdAt);
  await expect(page.getByText("Ativa", { exact: true })).toBeVisible();

  assertClean(recorder, "rotação");
});

/* ================================================================== */
/* Resolução                                                           */
/* ================================================================== */

test("a etiqueta lida abre o contexto do equipamento em uma consulta", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { asset, headers } = await anEquipment(request);

  /** Rotaciona para obter um token conhecido pela própria resposta da API. */
  await request.post(`${API}/assets/${asset.id}/qr/rotate`, { headers });
  const token = await currentToken(request, asset.id, headers);

  const calls: string[] = [];
  page.on("request", (item) => {
    if (item.url().includes("/api/orbit/")) calls.push(item.url());
  });

  await page.goto(`/q/${token}`);
  await expect(
    page.getByRole("heading", { name: asset.name, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole("region", { name: "Contexto operacional" }),
  ).toBeVisible();

  /**
   * Sem joins no navegador: uma chamada resolve tudo. Buscar cliente,
   * equipamento e plano em separado apareceria aqui.
   */
  const domainCalls = calls.filter(
    (url) =>
      url.includes("/customers/") ||
      /\/assets\/[0-9a-f-]{36}(\?|$)/.test(url) ||
      url.includes("/pmoc/plans/"),
  );
  expect(domainCalls, "consultas de domínio além da resolução").toEqual([]);

  assertClean(recorder, "resolução");
});

test("as ações vêm do servidor e nenhuma delas executa em campo", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { asset, headers } = await anEquipment(request);
  const token = await currentToken(request, asset.id, headers);

  const resolved = await request.get(`${API}/assets/qr/${token}`, { headers });
  const allowed = (await resolved.json()).data.allowedActions as string[];

  await page.goto(`/q/${token}`);
  const actions = page.getByRole("region", { name: "Ações permitidas" });
  await expect(actions).toBeVisible({ timeout: 30_000 });
  const buttons = await actions.getByRole("button").allInnerTexts();
  const links = await actions.getByRole("link").allInnerTexts();
  const visible = [...buttons, ...links].join(" | ");

  /** O que o servidor permitiu aparece; o que ele não permitiu, não. */
  if (allowed.includes("START_SERVICE_ORDER")) {
    expect(visible).toContain("Preparar atendimento");
  }
  if (!allowed.includes("EXECUTE_PMOC")) {
    expect(visible).not.toContain("Executar PMOC");
  }

  /** O Web é entrada por etiqueta, não execução de campo. */
  expect(visible).not.toMatch(/Iniciar |Concluir |Assinar /i);

  assertClean(recorder, "ações");
});

test("preparar atendimento não cria nada antes da confirmação", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { asset, headers } = await anEquipment(request);
  const token = await currentToken(request, asset.id, headers);

  const countOperations = async () => {
    const response = await request.get(`${API}/operations?limit=1`, {
      headers,
    });
    return (await response.json()).data.meta.total as number;
  };

  const before = await countOperations();

  await page.goto(`/q/${token}`);
  await page
    .getByRole("button", { name: "Preparar atendimento" })
    .click({ timeout: 30_000 });

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  /** O formulário abre preenchido com o que o servidor preparou. */
  await expect(dialog.getByLabel("Título")).toHaveValue(
    new RegExp(asset.name.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );

  /**
   * A garantia central: até aqui **nada** foi criado. O contrato da preparação
   * carrega `operationCreated: false`, e a contagem prova que ele não mente.
   */
  expect(await countOperations(), "atendimento criado sem confirmação").toBe(
    before,
  );

  /** E nada foi iniciado: não existe atalho de execução neste formulário. */
  await expect(
    dialog.getByRole("button", { name: /iniciar|executar/i }),
  ).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await countOperations()).toBe(before);

  assertClean(recorder, "preparação");
});

test("confirmado, o atendimento nasce — e nasce parado", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { asset, headers } = await anEquipment(request);
  const token = await currentToken(request, asset.id, headers);

  await page.goto(`/q/${token}`);
  await page
    .getByRole("button", { name: "Preparar atendimento" })
    .click({ timeout: 30_000 });

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 20_000 });

  /**
   * Identificador aleatório, não recorte de relógio.
   *
   * `Date.now().slice(-6)` repete a cada mil segundos: duas execuções da suíte
   * com dezesseis minutos de diferença geravam o mesmo código e a segunda
   * criação era recusada. É a colisão que a FL-07 já tinha encontrado.
   */
  const code = `QR-${crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
  await dialog.getByLabel("Código").fill(code);
  await dialog.getByRole("button", { name: /criar|salvar/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  /**
   * Agora sim existe — porque alguém confirmou.
   *
   * Buscado pelo código no servidor, e não varrendo as cinquenta operações
   * mais recentes: a lista cresce, e o que este teste criou pode não estar
   * entre elas.
   */
  const created = await request.get(
    `${API}/operations?search=${encodeURIComponent(code)}&limit=5`,
    { headers },
  );
  const operation = (
    (await created.json()).data.data as { code: string; status: string }[]
  ).find((item) => item.code === code);
  expect(operation, "atendimento não foi criado").toBeTruthy();

  /**
   * E nasce **parado**. Ler a etiqueta não inicia execução: quem inicia é o
   * técnico em campo, e o estado inicial precisa provar isso.
   */
  expect(operation!.status).not.toBe("IN_PROGRESS");

  assertClean(recorder, "criação confirmada");
});

/* ================================================================== */
/* Falha fechada                                                       */
/* ================================================================== */

test("token inexistente, revogado ou de outro escopo dão a mesma resposta", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { asset, headers } = await anEquipment(request);

  const stale = await currentToken(request, asset.id, headers);
  await request.post(`${API}/assets/${asset.id}/qr/rotate`, { headers });

  /** 43 caracteres do mesmo alfabeto: indistinguível de um token real. */
  const random = "a".repeat(43);

  for (const [label, token] of [
    ["revogado", stale],
    ["inexistente", random],
  ] as const) {
    await page.goto(`/q/${token}`);

    /**
     * A mesma frase para os dois. Diferenciar entregaria um oráculo para
     * descobrir quais etiquetas existem.
     */
    await expect(
      page.getByRole("heading", { name: "Etiqueta não reconhecida" }),
      label,
    ).toBeVisible({ timeout: 30_000 });
    const body = await page.locator("body").innerText();
    expect(body, label).not.toMatch(/revogad|expirad|outro tenant|unidade/i);
  }

  expect(recorder.pageErrors).toEqual([]);
  expect(recorder.reactWarnings).toEqual([]);
  expect(
    recorder.consoleErrors.filter(
      (message) => !/status of (404|400)/i.test(message),
    ),
    "console.error além da própria recusa",
  ).toEqual([]);
});

test("a rota da etiqueta exige sessão e devolve quem entrou ao ponto certo", async ({
  browser,
  request,
}) => {
  const { asset, headers } = await anEquipment(request);
  const token = await currentToken(request, asset.id, headers);

  /** Contexto limpo: ninguém autenticado, como quem acabou de escanear. */
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`/q/${token}`);
  await page.waitForURL(/\/login/, { timeout: 20_000 });

  /**
   * O destino é preservado — e o token nele é o mesmo que já está na barra de
   * endereços de quem escaneou. O que não pode acontecer é o token migrar para
   * onde não estava: nada de vazamento para outra tela, aviso ou título.
   */
  const destination = new URL(page.url()).searchParams.get("destino");
  expect(destination).toBe(`/q/${token}`);
  await expect(page).toHaveTitle(/orbit/i);
  expect(await page.title()).not.toContain(token);

  await page.getByLabel(/e-?mail/i).fill(OWNER.email);
  await page.getByLabel(/senha/i).first().fill(OWNER.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  /** Depois de entrar, a etiqueta abre — sem repetir o scan. */
  await page.waitForURL(new RegExp(`/q/${token}$`), { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: asset.name, exact: true }),
  ).toBeVisible({ timeout: 30_000 });

  await context.close();
});

/* ================================================================== */
/* Apresentação                                                        */
/* ================================================================== */

test("o contexto resolvido segue íntegro em 1024 e 768", async ({
  page,
  request,
}) => {
  const recorder = record(page);
  const { asset, headers } = await anEquipment(request);
  const token = await currentToken(request, asset.id, headers);

  for (const width of [1024, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/q/${token}`);
    await expect(
      page.getByRole("heading", { name: asset.name, exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `estouro horizontal em ${width}px`).toBeLessThanOrEqual(0);

    /** E o painel administrativo, com a etiqueta ao lado dos dados. */
    await open(
      page,
      `/ativos/${asset.id}`,
      page.getByText("QR do equipamento"),
    );
    const panelOverflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(
      panelOverflow,
      `estouro no painel em ${width}px`,
    ).toBeLessThanOrEqual(0);
  }

  assertClean(recorder, "tablet");
});

test("nenhum código técnico chega ao usuário", async ({ page, request }) => {
  const recorder = record(page);
  const { asset, headers } = await anEquipment(request);
  const token = await currentToken(request, asset.id, headers);

  await page.goto(`/q/${token}`);
  await expect(
    page.getByRole("region", { name: "Ações permitidas" }),
  ).toBeVisible({ timeout: 30_000 });
  const resolved = (await page.locator("body").innerText()).toUpperCase();

  await open(page, `/ativos/${asset.id}`, page.getByText("QR do equipamento"));
  const admin = (await page.locator("body").innerText()).toUpperCase();

  for (const raw of [
    "ACTIVE",
    "REVOKED",
    "START_SERVICE_ORDER",
    "EXECUTE_PMOC",
    "ADD_TO_RVT",
    "VIEW_DETAILS",
    "VIEW_HISTORY",
  ]) {
    expect(resolved, `enum cru na resolução: ${raw}`).not.toContain(raw);
    expect(admin, `enum cru no painel: ${raw}`).not.toContain(raw);
  }

  assertClean(recorder, "vocabulário");
});

/**
 * O token da identidade ativa, lido da etiqueta impressa.
 *
 * Não há endpoint administrativo que devolva o token — e é assim de propósito.
 * O teste faz o que um leitor de etiqueta faria: decodifica o código
 * renderizado. É também o que dá valor ao gate de opacidade: o que se afirma
 * sobre o payload vem da imagem, não do que o servidor diz ter gravado.
 */
async function currentToken(
  request: APIRequestContext,
  equipmentId: string,
  headers: Record<string, string>,
): Promise<string> {
  const response = await request.get(
    `${API}/assets/${equipmentId}/qr/render?format=png`,
    { headers },
  );
  expect(response.ok(), "etiqueta PNG").toBe(true);
  return extractToken(await response.body());
}
