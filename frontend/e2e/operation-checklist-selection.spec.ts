import { expect, test, type Page } from "@playwright/test";

const models = [
  {
    id: "general-a",
    key: "SEGURANCA",
    name: "Segurança em campo",
    isGeneral: true,
    operationKind: null,
  },
  {
    id: "general-b",
    key: "CONFERENCIA",
    name: "Conferência geral",
    isGeneral: true,
    operationKind: null,
  },
  {
    id: "maintenance",
    key: "MANUTENCAO",
    name: "Manutenção específica",
    isGeneral: false,
    operationKind: "MAINTENANCE",
  },
  {
    id: "manual",
    key: "MANUAL",
    name: "Modelo sem tipo",
    isGeneral: false,
    operationKind: null,
  },
].map((model) => ({
  ...model,
  version: 2,
  isActive: true,
  description: null,
  items: [
    {
      key: "filtro",
      label: `Item de ${model.name}`,
      type: "BOOLEAN",
      required: false,
    },
  ],
}));

async function fixture(page: Page, empty = false) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const catalogueQueries: URLSearchParams[] = [];
  const claims = {
    sub: "owner",
    sid: "checklist-test",
    type: "access",
    organizationId: "org",
    roles: [],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  await page
    .context()
    .addCookies([
      {
        name: "orbit_access",
        value: `preview.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.preview`,
        url: test.info().project.use.baseURL as string,
      },
    ]);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let data: unknown = {
      data: [],
      meta: { total: 0, page: 1, limit: 100, totalPages: 0 },
    };
    if (request.method() === "POST" || request.method() === "PATCH")
      writes.push({
        path,
        body: request.postDataJSON() as Record<string, unknown>,
      });
    if (path === "/api/auth/session")
      data = {
        authenticated: true,
        user: {
          id: "owner",
          firstName: "Marina",
          displayName: "Marina",
          welcomeDismissedAt: "2026-10-01T12:00:00Z",
        },
        scope: {
          organizationId: "org",
          businessUnitId: "unit",
          businessUnitIds: ["unit"],
        },
        isOwner: true,
        permissions: ["*"],
        roles: [],
        organization: { id: "org", displayName: "Empresa" },
        businessUnits: [
          {
            id: "unit",
            legalName: "Matriz",
            timezone: "America/Recife",
            isPrimary: true,
          },
        ],
        organizations: [],
        entitlements: { capabilities: ["*"], limits: {} },
        productAccess: null,
        isPlatformAdmin: false,
        subscriptionActive: true,
        requiresPasswordChange: false,
      };
    else if (path === "/api/orbit/checklist-templates") {
      if (request.method() === "GET") {
        catalogueQueries.push(url.searchParams);
        const number = Number(url.searchParams.get("page") ?? 1);
        data = {
          data: empty
            ? []
            : number === 1
              ? models.slice(0, 1)
              : models.slice(1),
          meta: {
            total: empty ? 0 : 4,
            page: number,
            limit: 100,
            totalPages: empty ? 0 : 2,
          },
        };
      } else
        data = {
          ...request.postDataJSON(),
          id: "saved-model",
          version: 1,
          isActive: true,
        };
    } else if (path === "/api/orbit/operations" && request.method() === "POST")
      data = { ...request.postDataJSON(), id: "created-operation" };
    else if (
      path.includes("field-technicians") ||
      path.includes("field-assistants") ||
      path.endsWith("/addresses")
    )
      data = [];
    await route.fulfill({ json: { success: true, data } });
  });
  return { writes, catalogueQueries };
}

async function openWizard(page: Page) {
  await page.goto("/operacoes");
  await page
    .getByRole("button", { name: /Nova opera/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await dialog
    .locator("#operation-title")
    .fill("Atendimento com seleção de checklists");
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  return dialog;
}

test("gerais de todas as páginas vêm selecionados e podem ser removidos sem reaparecer", async ({
  page,
}) => {
  const { writes, catalogueQueries } = await fixture(page);
  const dialog = await openWizard(page);
  const selected = dialog.getByRole("list", {
    name: "Checklists selecionados",
  });
  await expect(selected).toContainText("Segurança em campo");
  await expect(selected).toContainText("Conferência geral");
  await expect(selected).not.toContainText("Manutenção específica");
  await expect(selected).not.toContainText("Modelo sem tipo");
  expect(
    catalogueQueries.some((query) => query.get("page") === "2"),
  ).toBeTruthy();
  expect(
    catalogueQueries.every((query) => query.get("latestOnly") === "true"),
  ).toBeTruthy();
  await dialog
    .getByRole("button", {
      name: "Remover checklist Segurança em campo",
      exact: true,
    })
    .click();
  await dialog.getByRole("button", { name: "Voltar", exact: true }).click();
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(selected).not.toContainText("Segurança em campo");
  await dialog
    .getByRole("button", { name: "Remover todos", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    dialog.getByText("Nenhum selecionado", { exact: true }).last(),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Criar operação", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    writes.find((write) => write.path.endsWith("/operations"))?.body.checklists,
  ).toEqual([]);
});

test("permite combinar, substituir e criar com os modelos escolhidos e extras", async ({
  page,
}) => {
  const { writes } = await fixture(page);
  const dialog = await openWizard(page);
  await dialog
    .getByRole("button", {
      name: "Remover checklist Conferência geral",
      exact: true,
    })
    .click();
  await dialog.locator("#operation-checklist-add").click();
  await page.getByRole("option", { name: /Manutenção específica/ }).click();
  await dialog
    .locator("#operation-checklist-extra")
    .fill("Conferir o duto novo");
  await dialog
    .getByRole("button", { name: "Adicionar item", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    dialog.getByText("Segurança em campo, Manutenção específica"),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Criar operação", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const selection = writes.find((write) => write.path.endsWith("/operations"))
    ?.body.checklists;
  expect(selection).toEqual([
    {
      templateId: "general-a",
      additionalItems: [
        expect.objectContaining({
          label: "Conferir o duto novo",
          type: "BOOLEAN",
        }),
      ],
    },
    { templateId: "maintenance", additionalItems: [] },
  ]);
  expect(writes.some((write) => write.path.endsWith("/checklists"))).toBe(
    false,
  );
});

test("catálogo vazio permite prosseguir sem checklist", async ({ page }) => {
  const { writes } = await fixture(page, true);
  const dialog = await openWizard(page);
  await expect(dialog.getByText(/Nenhum checklist selecionado/)).toBeVisible();
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Criar operação", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(writes[0].body.checklists).toEqual([]);
});

test("cadastro de roteiro publica a opção geral explicitamente", async ({
  page,
}) => {
  const { writes } = await fixture(page);
  await page.goto("/catalogos");
  await page
    .getByRole("button", { name: "Novo roteiro", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Novo roteiro" });
  await dialog.locator("#template-name").fill("Segurança geral");
  await dialog
    .getByRole("checkbox", { name: "Checklist geral", exact: true })
    .check();
  await expect(dialog.locator("#template-kind")).toBeDisabled();
  await dialog.locator("#template-new-item").fill("Conferir os EPIs");
  await dialog.getByRole("button", { name: "Adicionar", exact: true }).click();
  await dialog.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[0].body).toMatchObject({
    isGeneral: true,
    operationKind: null,
    name: "Segurança geral",
  });
});
