/**
 * Recursos próprios para cada cenário.
 *
 * ## Por que existe
 *
 * Vários specs abriam "o primeiro registro que casar" numa listagem do tenant
 * compartilhado — `getByRole("link", { name: /OS-/ }).first()`. Funcionava
 * enquanto a lista era pequena. Com 225 operações, a primeira página passou a
 * ser inteira de visitas avulsas criadas por outros testes, e as operações
 * semeadas que esses cenários precisavam saíram da página: três testes de
 * `professional` e dois de `server-authority` falhavam sem que nada do produto
 * tivesse mudado.
 *
 * Aqui cada cenário cria o que vai usar, pela API real, e guarda o `id` — não
 * procura, não adivinha, não depende de ordenação nem de quantos registros
 * existem. Repetir a suíte dez vezes dá o mesmo resultado.
 *
 * ## O que este módulo não faz
 *
 * Não apaga nada ao final. Operação tem histórico e auditoria, e remover por
 * SQL o que a aplicação criou falsearia o estado do tenant — a lição da FL-07.
 * Os registros ficam, identificados pelo prefixo do cenário.
 */
import { expect, type APIResponse, type Page } from "@playwright/test";

/**
 * Uma chamada ao BFF com a sessão do navegador.
 *
 * O proxy exige metadados de origem (`sec-fetch-site: same-origin`) e recusa
 * com `FORBIDDEN_ORIGIN` quem não os manda — é a proteção contra requisição
 * disparada de outra página. O teste manda o que o navegador mandaria em vez
 * de contorná-la.
 */
export async function bff(
  page: Page,
  method: "get" | "post" | "patch",
  path: string,
  data?: unknown,
  extra?: Record<string, string>,
): Promise<APIResponse> {
  const origin = new URL(page.url()).origin;
  const headers = {
    Origin: origin,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    ...extra,
  };
  if (method === "get") return page.request.get(path, { headers });
  if (method === "post") return page.request.post(path, { headers, data });
  return page.request.patch(path, { headers, data });
}

async function json<T>(response: APIResponse): Promise<T> {
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json();
  return (body.data ?? body) as T;
}

/**
 * Identificador único de cenário.
 *
 * `randomUUID`, e não um prefixo de tempo: dois testes que começam no mesmo
 * milissegundo colidiam — foi assim que a FL-07 descobriu o problema.
 */
export function scenarioId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** A unidade em que o cenário vai criar as coisas. */
export async function activeBusinessUnit(page: Page): Promise<string> {
  const units = await json<
    { data?: Array<{ id: string }> } | Array<{ id: string }>
  >(
    await bff(
      page,
      "get",
      "/api/orbit/organizations/current/business-units?limit=1",
    ),
  );
  const rows = Array.isArray(units) ? units : (units.data ?? []);
  expect(
    rows.length,
    "o tenant precisa de ao menos uma unidade",
  ).toBeGreaterThan(0);
  return rows[0].id;
}

export interface ProvisionedOperation {
  readonly id: string;
  readonly code: string;
  readonly title: string;
}

/**
 * Uma operação recém-criada, só deste cenário.
 *
 * Nasce sem equipe e no status inicial, que é justamente o estado em que os
 * cenários de papéis e de transição de status querem encontrá-la.
 */
export async function provisionOperation(
  page: Page,
  label: string,
): Promise<ProvisionedOperation> {
  const businessUnitId = await activeBusinessUnit(page);
  const suffix = scenarioId();
  const code = `E2E-${label}-${suffix}`.toUpperCase().slice(0, 60);
  const title = `Cenário ${label} ${suffix}`;

  const created = await json<{ id: string; code: string }>(
    await bff(page, "post", "/api/orbit/operations", {
      businessUnitId,
      code,
      kind: "MAINTENANCE",
      title,
    }),
  );

  return { id: created.id, code: created.code, title };
}

/**
 * A mesma operação, já com equipe montada pelos comandos reais.
 *
 * O cenário de promoção precisa encontrar um responsável e um auxiliar. Antes
 * ele contava com a equipe que outro teste tivesse deixado na primeira `OS-`
 * da lista — o que amarrava o resultado à ordem de execução. Agora ele monta a
 * equipe que vai usar, pelos mesmos endpoints que a tela usa.
 */
export async function provisionOperationWithTeam(
  page: Page,
  label: string,
): Promise<ProvisionedOperation & { responsible: string; auxiliary: string }> {
  const operation = await provisionOperation(page, label);

  const technicians = await json<Array<{ id: string; name: string }>>(
    await bff(page, "get", "/api/orbit/workforce/field-technicians"),
  );
  expect(
    technicians.length,
    "o cenário precisa de dois Técnicos em Campo elegíveis",
  ).toBeGreaterThanOrEqual(2);

  const [first, second] = technicians;
  await json(
    await bff(
      page,
      "patch",
      `/api/orbit/operations/${operation.id}/responsible-field-technician`,
      { userId: first.id },
    ),
  );
  await json(
    await bff(
      page,
      "post",
      `/api/orbit/operations/${operation.id}/auxiliary-technicians`,
      { userId: second.id },
    ),
  );

  return {
    ...operation,
    responsible: first.name,
    auxiliary: second.name,
  };
}

/**
 * A linha desta operação na listagem, encontrada pela busca do produto.
 *
 * A alternativa era `getByRole("row").first()`, que aponta para o registro
 * mais recente do tenant — outro teste cria uma visita avulsa e o cenário
 * passa a agir sobre ela. Buscar pelo código faz o teste operar exatamente o
 * que provisionou, com a lista do tamanho que estiver.
 */
export async function operationRow(page: Page, code: string) {
  await page.goto("/operacoes");
  await page.getByLabel("Buscar").fill(code);
  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toHaveCount(1, { timeout: 20_000 });
  return row;
}

export interface ProvisionedPmocPlan {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly customerId: string;
  /** Os equipamentos criados, nenhum ainda coberto pelo plano. */
  readonly assets: readonly { id: string; name: string }[];
}

/**
 * Um plano PMOC com cliente e parque de equipamentos próprios.
 *
 * ## O que isto resolve
 *
 * Os cenários de cobertura usavam o plano semeado "Manutenção preventiva", cujo
 * cliente tem dezesseis equipamentos. Cada execução da suíte adicionava alguns
 * à cobertura, e o conjunto de equipamentos **ainda não cobertos** encolhia:
 * depois de algumas rodadas o seletor não tinha página seguinte, "Sala 9" já
 * estava coberto, e três testes falhavam sem que o produto tivesse mudado.
 *
 * Aqui o cenário traz o próprio cliente e os próprios equipamentos. O conjunto
 * disponível é conhecido, não é disputado com ninguém, e não encolhe entre
 * execuções porque cada execução cria o seu.
 */
export async function provisionPmocPlan(
  page: Page,
  label: string,
  assetCount = 16,
): Promise<ProvisionedPmocPlan> {
  const businessUnitId = await activeBusinessUnit(page);
  const suffix = scenarioId();

  const customer = await json<{ id: string }>(
    await bff(page, "post", "/api/orbit/customers", {
      type: "COMPANY",
      legalName: `Cenário PMOC ${label} ${suffix}`,
    }),
  );

  /**
   * O nome carrega a posição para que a busca do seletor tenha um termo
   * previsível — "Sala 09" existe porque o cenário o criou, não porque o seed
   * o trouxe.
   */
  const assets: { id: string; name: string }[] = [];
  for (let index = 1; index <= assetCount; index += 1) {
    const name = `Sala ${String(index).padStart(2, "0")} ${suffix}`;
    const asset = await json<{ id: string }>(
      await bff(page, "post", "/api/orbit/assets", {
        businessUnitId,
        customerId: customer.id,
        category: "EQUIPMENT",
        name,
      }),
    );
    assets.push({ id: asset.id, name });
  }

  /**
   * A ativação exige ao menos uma cobertura operacional. Este equipamento é
   * a âncora do cenário e não integra a lista devolvida: os equipamentos
   * `Sala` continuam todos livres para os testes de busca, inclusão e conflito.
   */
  const anchor = await json<{ id: string }>(
    await bff(page, "post", "/api/orbit/assets", {
      businessUnitId,
      customerId: customer.id,
      category: "EQUIPMENT",
      name: `Cobertura inicial ${suffix}`,
    }),
  );

  const code = `E2E-PMOC-${suffix}`.toUpperCase().slice(0, 60);
  const name = `Cenário PMOC ${label} ${suffix}`;
  const plan = await json<{ id: string }>(
    await bff(page, "post", "/api/orbit/pmoc/plans", {
      businessUnitId,
      customerId: customer.id,
      code,
      name,
      startsOn: new Date().toISOString().slice(0, 10),
      frequencyAmount: 1,
      frequencyUnit: "MONTHS",
      assetIds: [anchor.id],
    }),
  );

  /**
   * O plano nasce em rascunho, e os cenários de ciclo de vida esperam
   * encontrá-lo ativo — que era o estado do plano semeado que eles usavam.
   * Ativar aqui é o mesmo comando que a tela oferece.
   */
  await json(
    await bff(page, "post", `/api/orbit/pmoc/plans/${plan.id}/activate`, {}),
  );

  return { id: plan.id, code, name, customerId: customer.id, assets };
}

/** Cobre um equipamento pelo comando real, quando o cenário só precisa do estado. */
export async function coverAsset(
  page: Page,
  planId: string,
  assetId: string,
): Promise<void> {
  await json(
    await bff(page, "post", `/api/orbit/pmoc/plans/${planId}/equipment`, {
      assetId,
    }),
  );
}

/** Suspende o plano pelo comando real, quando o cenário precisa desse estado. */
export async function suspendPlan(page: Page, planId: string): Promise<void> {
  await json(
    await bff(page, "post", `/api/orbit/pmoc/plans/${planId}/suspend`, {}),
  );
}

/**
 * Uma operação com uma execução de artefato vinculada a ela.
 *
 * Os cenários de contexto da H04 procuravam, entre as sessenta execuções mais
 * recentes, duas que tivessem operação — e se pulavam quando não encontravam.
 * Um cenário obrigatório que se pula não prova nada: agora o vínculo é criado
 * aqui, e o teste sabe exatamente qual execução espera ver em qual operação.
 */
export async function provisionOperationWithArtifact(
  page: Page,
  label: string,
): Promise<
  ProvisionedOperation & { executionId: string; executionCode: string }
> {
  const businessUnitId = await activeBusinessUnit(page);
  const operation = await provisionOperation(page, label);

  const templates = await json<{
    data?: Array<{ id: string; status: string }>;
  }>(await bff(page, "get", "/api/orbit/artifact-templates?limit=10"));
  const template = (templates.data ?? []).find(
    (item) => item.status === "ACTIVE",
  );
  expect(
    template,
    "o tenant precisa de um modelo de documento publicado",
  ).toBeTruthy();

  const code = `E2EART${scenarioId()}`.toUpperCase();
  const execution = await json<{ id: string; code: string }>(
    await bff(page, "post", "/api/orbit/artifact-executions", {
      businessUnitId,
      templateId: template!.id,
      operationId: operation.id,
      code,
      title: `Documento ${label} ${operation.code}`,
    }),
  );

  return {
    ...operation,
    executionId: execution.id,
    executionCode: execution.code,
  };
}

export interface ProvisionedRvt {
  readonly configurationId: string;
  readonly executionId: string;
  readonly name: string;
}

/**
 * Uma visita avulsa de RVT, criada e concluída pelo caminho do app de campo.
 *
 * O cenário que abre a execução no contexto do RVT dependia de encontrar uma
 * configuração que já tivesse visita executada — e se pulava quando a primeira
 * da lista não tinha. Aqui a visita é do cenário: existe sempre, e ele conhece
 * a configuração e a execução pelo identificador.
 */
export async function provisionRvtVisit(
  page: Page,
  label: string,
): Promise<ProvisionedRvt> {
  const businessUnitId = await activeBusinessUnit(page);
  const suffix = scenarioId();

  const customer = await json<{ id: string }>(
    await bff(page, "post", "/api/orbit/customers", {
      type: "COMPANY",
      legalName: `Cenário RVT ${label} ${suffix}`,
    }),
  );

  const asset = await json<{ id: string }>(
    await bff(page, "post", "/api/orbit/assets", {
      businessUnitId,
      customerId: customer.id,
      category: "EQUIPMENT",
      name: `Equipamento RVT ${suffix}`,
    }),
  );

  /**
   * O ritmo vem do catálogo da organização, não de um literal.
   *
   * Era `visitType: "WEEKLY"`. Os tipos de manutenção passaram a ser cadastro
   * — cada um com a própria cadência e o próprio roteiro — e toda organização
   * nasce com os sete. O cenário procura o desta conta em vez de fixar um
   * código que o servidor não conhece mais.
   */
  const tipos = await json<{ id: string; key: string }[]>(
    await bff(page, "get", "/api/orbit/rvt/maintenance-types"),
  );
  const semanal = tipos.find((tipo) => tipo.key === "WEEKLY");
  if (!semanal) throw new Error("organização sem o tipo de manutenção semanal");

  const name = `Visita avulsa — ${label} ${suffix}`;
  const created = await json<{ execution: { id: string } }>(
    await bff(
      page,
      "post",
      "/api/orbit/rvt/ad-hoc/executions",
      {
        businessUnitId,
        customerId: customer.id,
        name,
        maintenanceTypeId: semanal.id,
        timezone: "America/Recife",
        serviceLocation: { city: "Recife" },
        procedure: { items: [] },
        equipmentIds: [asset.id],
      },
      /** A criação é idempotente no contrato; a chave é do cenário. */
      { "idempotency-key": `e2e-rvt-${suffix}` },
    ),
  );

  /**
   * A criação devolve a execução; a configuração vem da listagem, filtrada
   * pelo cliente que este cenário acabou de criar — que é dele e só dele.
   */
  const configurations = await json<{ data?: Array<{ id: string }> }>(
    await bff(
      page,
      "get",
      `/api/orbit/rvt/configurations?customerId=${customer.id}&limit=1`,
    ),
  );
  const configurationId = (configurations.data ?? [])[0]?.id;
  expect(configurationId, "a visita avulsa cria uma configuração").toBeTruthy();

  return {
    configurationId: configurationId!,
    executionId: created.execution.id,
    name,
  };
}

/**
 * O plano semeado, encontrado pelo código — que é estável.
 *
 * Alguns cenários leem o conteúdo do seed (equipamentos com nome conhecido,
 * ciclos já abertos) e não podem trazer o próprio plano sem replicar tudo
 * isso. O que eles podem é parar de procurar por nome: o nome é editável, e
 * bastou um cenário renomear o seu plano para o locator encontrar três links e
 * falhar por ambiguidade. Código não se edita.
 */
export async function seededPmocPlanId(
  page: Page,
  code: string,
): Promise<string> {
  const plans = await json<{ data?: Array<{ id: string; code: string }> }>(
    await bff(
      page,
      "get",
      `/api/orbit/pmoc/plans?search=${encodeURIComponent(code)}&limit=10`,
    ),
  );
  const plan = (plans.data ?? []).find((item) => item.code === code);
  expect(plan, `o tenant precisa do plano semeado ${code}`).toBeTruthy();
  return plan!.id;
}
