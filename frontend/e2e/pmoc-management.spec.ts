/**
 * Gestão de PMOC pela interface: cobertura e vida do plano.
 *
 * Os três buracos que mantiveram a PR-FE-03 aberta — cobertura só de leitura,
 * lifecycle sem superfície e suspensão sem prova — fecham aqui, contra backend
 * real.
 *
 * A suíte roda em série e compartilha um plano; cada teste deixa o estado que
 * o seguinte encontra, como aconteceria com duas pessoas usando o produto.
 */
import { expect, test } from "@playwright/test";
import { coverAsset, provisionPmocPlan, suspendPlan } from "./provision";
import { assertClean, login, record, settled } from "./support";

/** Abre o plano de teste e para na aba pedida. */
/**
 * Abre a aba de um plano que o cenário conhece pelo `id`.
 *
 * Antes clicava no plano semeado "Manutenção preventiva" e mexia na cobertura
 * dele. O conjunto de equipamentos **não cobertos** daquele cliente encolhia a
 * cada execução da suíte: depois de algumas rodadas o seletor perdia a página
 * seguinte e "Sala 9" já estava coberto — três cenários falhavam sem que o
 * produto tivesse mudado. Cada teste agora traz o seu plano.
 */
async function openPlan(
  page: import("@playwright/test").Page,
  planId: string,
  tab: string,
) {
  await page.goto(`/pmoc/${planId}`);
  await settled(page);
  await page.getByRole("tab", { name: tab }).click();
  await settled(page);
}

test("o seletor de equipamento pagina no servidor e busca", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  const plan = await provisionPmocPlan(page, "paginacao");
  await openPlan(page, plan.id, "Cobertura");

  await page.getByRole("button", { name: /Adicionar equipamento/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  /**
   * Paginação de verdade: o cliente tem 16 equipamentos e o seletor pede 10.
   * Uma lista carregada inteira e filtrada localmente não teria "Próxima".
   */
  const next = dialog.getByRole("button", { name: "Próxima" });
  await expect(next).toBeEnabled();

  const list = dialog.getByRole("list", { name: "Equipamentos disponíveis" });
  const firstItem = await list.getByRole("listitem").first().innerText();
  await next.click();
  /** Esperar a lista trocar — `networkidle` não garante o repintar. */
  await expect(list.getByRole("listitem").first()).not.toHaveText(firstItem, {
    timeout: 20_000,
  });

  /** A busca também é do servidor: o termo volta na consulta, não no filtro. */
  let queries = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/orbit/assets")) queries += 1;
  });
  /** Digitado tecla a tecla: é o que prova que a consulta espera a digitação parar. */
  await dialog
    .getByLabel("Buscar", { exact: true })
    .pressSequentially("Sala 07", { delay: 40 });
  await page.waitForTimeout(1_500);
  await settled(page);

  /** Sete teclas não podem virar sete consultas. */
  expect(queries).toBeLessThan(4);
  await expect(dialog.getByText(plan.assets[6].name)).toBeVisible();

  await page.keyboard.press("Escape");
  assertClean(recorder, "seletor de equipamento");
});

test("adicionar equipamento persiste e sobrevive à recarga", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  const plan = await provisionPmocPlan(page, "adicionar");
  const escolhido = plan.assets[8];
  await openPlan(page, plan.id, "Cobertura");

  await page.getByRole("button", { name: /Adicionar equipamento/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Buscar", { exact: true }).fill(escolhido.name);
  await page.waitForTimeout(1_200);
  await settled(page);

  await dialog.getByRole("button", { name: escolhido.name }).click();
  await dialog.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await settled(page);

  await expect(page.getByRole("cell", { name: escolhido.name }).first()).toBeVisible();

  /** Persistência: recarregar não é cache — é o servidor respondendo de novo. */
  await page.reload();
  await settled(page);
  await page.getByRole("tab", { name: "Cobertura" }).click();
  await settled(page);
  await expect(page.getByRole("cell", { name: escolhido.name }).first()).toBeVisible();

  assertClean(recorder, "adicionar cobertura");
});

test("equipamento já coberto não é oferecido de novo", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  const plan = await provisionPmocPlan(page, "duplicidade");
  const coberto = plan.assets[8];
  /** O estado de partida é montado pelo comando real, não por outro teste. */
  await coverAsset(page, plan.id, coberto.id);
  await openPlan(page, plan.id, "Cobertura");

  await page.getByRole("button", { name: /Adicionar equipamento/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Buscar", { exact: true }).fill(coberto.name);
  await page.waitForTimeout(1_200);
  await settled(page);

  /**
   * Some da oferta porque já está coberto. A regra continua sendo do servidor,
   * que responde `CONFLICT` — isto aqui evita oferecer o que seria recusado.
   */
  await expect(dialog.getByRole("button", { name: coberto.name })).toHaveCount(0);

  await page.keyboard.press("Escape");
  assertClean(recorder, "duplicidade");
});

test("remover da cobertura confirma e persiste", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  const plan = await provisionPmocPlan(page, "remover");
  const coberto = plan.assets[8];
  await coverAsset(page, plan.id, coberto.id);
  await openPlan(page, plan.id, "Cobertura");

  const row = page.getByRole("row").filter({ hasText: coberto.name });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Remover/ }).click();

  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(confirm).toBeVisible();
  /** A frase diz o efeito real: sai das próximas execuções, histórico fica. */
  await expect(confirm).toContainText(/próximas execuções/i);
  await confirm.getByRole("button", { name: "Remover", exact: true }).click();
  await expect(confirm).toBeHidden({ timeout: 20_000 });
  await settled(page);

  await page.reload();
  await settled(page);
  await page.getByRole("tab", { name: "Cobertura" }).click();
  await settled(page);
  await expect(page.getByRole("cell", { name: /Sala 9/ })).toHaveCount(0);

  assertClean(recorder, "remover cobertura");
});

test("as ações de estado vêm das transições publicadas pelo servidor", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  const plan = await provisionPmocPlan(page, "acoes", 4);
  await openPlan(page, plan.id, "Visão geral");

  await page.getByRole("button", { name: /Ações do plano/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();

  /**
   * O plano está ativo, e o servidor publica `SUSPENDED` e `CANCELLED` como
   * transições. "Ativar" não aparece — não porque a tela deduziu do status,
   * mas porque não veio em `allowedTransitions`.
   */
  await expect(menu.getByRole("menuitem", { name: "Suspender" })).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Cancelar plano" }),
  ).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Ativar" })).toHaveCount(0);

  await page.keyboard.press("Escape");
  assertClean(recorder, "menu de estado");
});

test("editar o plano salva e o servidor confirma", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  const plan = await provisionPmocPlan(page, "editar", 4);
  await openPlan(page, plan.id, "Visão geral");

  await page.getByRole("button", { name: "Editar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  /** Cliente, unidade e código são imutáveis — nem aparecem como campo. */
  await expect(dialog).toContainText(/não mudam/i);

  /**
   * O novo nome carrega o do cenário.
   *
   * Renomear para "Manutenção preventiva — sede administrativa" colidia com o
   * plano semeado: o locator por nome de outro spec passava a encontrar três
   * links e falhava por ambiguidade.
   */
  const novo = `${plan.name} — revisado`;
  await dialog.getByLabel("Nome").fill(novo);
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await settled(page);

  await page.reload();
  await settled(page);
  await expect(page.getByRole("heading", { name: novo })).toBeVisible();

  assertClean(recorder, "editar plano");
});

test("suspender o plano bloqueia a execução, com o motivo do servidor", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  const plan = await provisionPmocPlan(page, "suspender", 4);
  /**
   * O motivo do bloqueio aparece por equipamento coberto: sem cobertura, a aba
   * de execuções não tem linha onde mostrá-lo.
   */
  await coverAsset(page, plan.id, plan.assets[0].id);
  await openPlan(page, plan.id, "Visão geral");

  await page.getByRole("button", { name: /Ações do plano/ }).click();
  await page.getByRole("menuitem", { name: "Suspender" }).click();

  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(confirm).toContainText(/já abertas ficam indisponíveis/i);
  await confirm.getByRole("button", { name: "Suspender" }).click();
  await expect(confirm).toBeHidden({ timeout: 20_000 });
  await settled(page);

  /** O estado é o publicado, e o aviso explica o que ele significa. */
  await expect(page.getByText("Suspenso").first()).toBeVisible();
  await expect(page.getByText(/novas execuções não são abertas/i)).toBeVisible();

  /**
   * A prova do bloqueio não é o badge: é `execution-preparation` respondendo
   * `PLAN_NOT_ACTIVE` para cada equipamento da execução. A tela traduz o código —
   * e nunca o deduz de `status === "SUSPENDED"`.
   */
  await page.getByRole("tab", { name: "Execuções" }).click();
  await settled(page);
  await expect(
    page.getByText(/O plano não está ativo/i).first(),
  ).toBeVisible({ timeout: 20_000 });

  const body = await page.evaluate(() => document.body.innerText);
  expect(body).not.toContain("PLAN_NOT_ACTIVE");
  expect(body).not.toContain("SUSPENDED");

  assertClean(recorder, "plano suspenso");
});

test("reativar devolve o plano ao estado ativo", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  const plan = await provisionPmocPlan(page, "reativar", 4);
  /** O cenário parte de um plano suspenso, montado pelo comando real. */
  await suspendPlan(page, plan.id);
  await openPlan(page, plan.id, "Visão geral");

  await page.getByRole("button", { name: /Ações do plano/ }).click();
  /** Agora sim "Ativar" aparece — porque o servidor voltou a publicá-la. */
  await page.getByRole("menuitem", { name: "Ativar" }).click();

  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await confirm.getByRole("button", { name: "Ativar" }).click();
  await expect(confirm).toBeHidden({ timeout: 20_000 });
  await settled(page);

  await expect(page.getByText("Ativo").first()).toBeVisible();
  await expect(page.getByText(/novas execuções não são abertas/i)).toHaveCount(0);

  assertClean(recorder, "reativar plano");
});

test("conflito real de cobertura não duplica e explica o que houve", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  const plan = await provisionPmocPlan(page, "conflito", 4);
  await openPlan(page, plan.id, "Cobertura");

  await page.getByRole("button", { name: /Adicionar equipamento/ }).first().click();
  const dialog = page.getByRole("dialog");
  const list = dialog.getByRole("list", { name: "Equipamentos disponíveis" });

  /** Seja qual for o candidato oferecido agora — o teste não fixa um nome. */
  const candidate = list.getByRole("listitem").first().getByRole("button");
  await expect(candidate).toBeVisible();
  const label = (await candidate.innerText()).split("\n")[0]!.trim();
  await candidate.click();

  /**
   * Outra pessoa inclui o mesmo equipamento **enquanto o diálogo está aberto**.
   *
   * É o conflito realista: o seletor foi montado com uma verdade que deixou de
   * valer. A tela não tem como saber, e não deve adivinhar — quem recusa é o
   * servidor, com `409`.
   */
  const planId = page.url().split("/").pop()!;
  const parallel = await page.evaluate(
    async ({
      id,
      name,
      customerId,
    }: {
      id: string;
      name: string;
      customerId: string;
    }) => {
      /*
        Procurado dentro do cliente do plano, e casando o nome inteiro.

        A busca era global com `limit=1`: o catálogo da organização acumula os
        equipamentos das outras execuções da suíte, e um homônimo de outro
        cliente chegava primeiro. Aí a inclusão "paralela" incluía outra coisa —
        ou batia em algo já coberto e voltava 409 antes da hora. Sozinho o teste
        passava, porque o catálogo estava vazio.
      */
      const found = await fetch(
        `/api/orbit/assets?customerId=${customerId}&search=${encodeURIComponent(name)}&limit=50`,
        { headers: { "sec-fetch-site": "same-origin" } },
      ).then((response) => response.json());
      const asset = (
        found as { data: { data: { id: string; name: string }[] } }
      ).data.data.find((candidato) => candidato.name === name);
      if (!asset) return 0;
      const response = await fetch(`/api/orbit/pmoc/plans/${id}/equipment`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ assetId: asset.id }),
      });
      return response.status;
    },
    { id: planId, name: label, customerId: plan.customerId },
  );
  expect(parallel, "a inclusão paralela deveria ter sido aceita").toBe(201);

  /** Agora o clique do usuário encontra o conflito. */
  await dialog.getByRole("button", { name: "Adicionar", exact: true }).click();

  /**
   * O erro aparece **dentro do diálogo**, com a copy pública do servidor e a
   * referência de suporte. Nada foi sobrescrito em silêncio.
   *
   * A asserção é sobre o **conflito ter sido comunicado**, e não sobre a frase.
   * A PR-35 tornou a copy pública determinística e em PT-BR: o texto inglês do
   * domínio (`already covered`) deixou de sair da API, e um teste preso à
   * mensagem passaria a reprovar a cada ajuste de copy — que é exatamente o
   * acoplamento que a PR-35 removeu do produto.
   */
  await expect(dialog.getByRole("alert").first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog.getByRole("alert").first()).toContainText(/conflito/i);

  await page.keyboard.press("Escape");
  await settled(page);

  /**
   * E nada duplicou.
   *
   * A conferência é contra o servidor, não contra a tabela: a cobertura é
   * paginada por cursor, e o equipamento pode estar em outra página — ausência
   * na página visível não provaria nada.
   */
  const occurrences = await page.evaluate(
    async ({ id, name }: { id: string; name: string }) => {
      const page1 = await fetch(
        `/api/orbit/pmoc/plans/${id}/equipment-page?limit=100`,
        { headers: { "sec-fetch-site": "same-origin" } },
      ).then((response) => response.json());
      const rows = (
        page1 as { data: { data: { asset: { name: string } }[] } }
      ).data.data;
      return rows.filter((row) => row.asset.name === name).length;
    },
    { id: planId, name: label },
  );
  expect(occurrences, "cobertura duplicada").toBe(1);

  expect(recorder.pageErrors).toEqual([]);
  expect(recorder.reactWarnings).toEqual([]);
});
