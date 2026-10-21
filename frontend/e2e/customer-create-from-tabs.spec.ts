import { expect, test, type Page } from "@playwright/test";

const CUSTOMER = "01900000-0000-7000-8000-000000000001";
const PATH = `/clientes/${CUSTOMER}`;
const NAME = "Cliente da ficha";

/** Exercise the existing forms in the customer page, with isolated API fixtures. */
async function setup(
  page: Page,
  readOnly = false,
  options: { template?: boolean; failFirstOperation?: boolean } = {},
) {
  const date = "2026-10-21T12:00:00Z";
  const user = {
    id: "user",
    email: "owner@example.test",
    firstName: "Marina",
    displayName: "Marina",
    welcomeDismissedAt: date,
  };
  const unit = {
    id: "unit",
    isPrimary: true,
    legalName: "Matriz",
    timezone: "America/Recife",
  };
  const session = {
    authenticated: true,
    user,
    scope: {
      organizationId: "organization",
      businessUnitId: "unit",
      businessUnitIds: ["unit"],
    },
    isOwner: !readOnly,
    permissions: readOnly
      ? ["crm.read", "operations.read", "quotes.read"]
      : ["*"],
    roles: [],
    organization: { id: "organization", displayName: "Empresa" },
    businessUnits: [unit],
    organizations: [],
    entitlements: {
      capabilities: readOnly
        ? ["crm.read", "operations.read", "quotes.read"]
        : ["*"],
    },
    productAccess: null,
    isPlatformAdmin: false,
    subscriptionActive: true,
    requiresPasswordChange: false,
  };
  const operations: Record<string, unknown>[] = [];
  const addresses: Record<string, unknown>[] = [];
  let operationAttempts = 0;
  const quotes: Record<string, unknown>[] = [];
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const copyQueries: URLSearchParams[] = [];
  const customer = {
    id: CUSTOMER,
    legalName: NAME,
    tradeName: null,
    type: "COMPANY",
    status: "ACTIVE",
    documentType: null,
    documentNumber: null,
    email: null,
    phone: null,
    address: null,
    notes: null,
    contacts: [],
    counts: { assets: 0, operations: 0 },
    createdAt: date,
    updatedAt: date,
  };
  const paginate = (data: unknown[]) => ({
    data,
    meta: {
      page: 1,
      limit: 10,
      total: data.length,
      totalPages: data.length ? 1 : 0,
    },
  });
  const claims = {
    sub: user.id,
    sid: "preview",
    type: "access",
    organizationId: "organization",
    roles: [],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  await page.context().addCookies([
    {
      name: "orbit_access",
      value: `preview.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.preview`,
      url: test.info().project.use.baseURL as string,
    },
  ]);
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    let data: unknown = paginate([]);
    if (method === "POST") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      if (path === `/api/orbit/customers/${CUSTOMER}/addresses`) {
        data = {
          ...body,
          id: "address-new",
          customerId: CUSTOMER,
          summary: "Rua da Aurora, 100 — Recife/PE",
          isActive: true,
        };
        addresses.push(data as Record<string, unknown>);
      } else if (path === "/api/orbit/operations") {
        operationAttempts += 1;
        if (options.failFirstOperation && operationAttempts === 1) {
          await route.fulfill({
            status: 400,
            json: {
              success: false,
              error: {
                code: "VALIDATION_ERROR",
                message: "Confira os dados do atendimento",
              },
            },
          });
          return;
        }
        data = {
          ...body,
          id: "operation-new",
          status: "OPEN",
          manualAmount:
            body.manualAmount == null ? null : String(body.manualAmount),
          users: [],
          assets: [],
          auxiliaryTechnicians: [],
          checklistExecutions: [],
          allowedActions: ["EDIT"],
          businessUnit: unit,
          customer: { id: CUSTOMER, legalName: NAME, tradeName: null },
          scheduledStart: null,
          createdAt: date,
          updatedAt: date,
        };
        operations.unshift(data as Record<string, unknown>);
        customer.counts.operations += 1;
      } else if (path === "/api/orbit/quotes") {
        data = {
          ...body,
          id: "quote-new",
          code: "ORC-001",
          status: "DRAFT",
          total: 100,
          customer: { id: CUSTOMER, displayName: NAME },
          assets: [],
          responsible: { displayName: "Marina" },
          transitions: { canApprove: false, canCancel: false },
          createdAt: date,
          updatedAt: date,
        };
        quotes.unshift(data as Record<string, unknown>);
      } else if (path.startsWith("/api/orbit/quotes/quote-new/")) {
        if (path.endsWith("/send")) quotes[0].status = "SENT";
        data = quotes[0];
      }
    } else if (
      method === "PATCH" &&
      path === "/api/orbit/operations/operation-new"
    ) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      Object.assign(operations[0], body);
      data = operations[0];
    } else if (path === "/api/auth/session") data = session;
    else if (path === `/api/orbit/customers/${CUSTOMER}`) data = customer;
    else if (path.endsWith("/addresses")) data = addresses;
    else if (path === "/api/orbit/checklist-templates" && options.template)
      data = paginate([
        {
          id: "template-maintenance",
          name: "Manutenção",
          items: [
            {
              key: "filter",
              label: "Limpeza dos filtros",
              type: "BOOLEAN",
              required: true,
            },
          ],
        },
      ]);
    else if (path === "/api/orbit/operations") {
      if (url.searchParams.get("status") === "COMPLETED")
        copyQueries.push(url.searchParams);
      data = paginate(operations);
    } else if (path === "/api/orbit/quotes") data = paginate(quotes);
    else if (path === "/api/orbit/organizations/current/members")
      data = paginate([
        {
          userId: user.id,
          displayName: "Marina",
          email: user.email,
          role: { name: "Owner" },
          hasSignature: false,
        },
      ]);
    else if (
      path.includes("scheduling") ||
      path.includes("workforce") ||
      path.includes("specialties")
    )
      data = [];
    else if (path.endsWith("/identity/me/avatar"))
      data = { available: false, url: null };
    else if (path.includes("notifications")) data = { unread: 0, data: [] };
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(PATH);
  await expect(
    page.getByRole("heading", { name: NAME, exact: true }),
  ).toBeVisible();
  return { writes, copyQueries };
}

test("creates an operation for the selected customer and refreshes the tab and counter", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page.getByRole("tab", { name: /^Operações/ }).click();
  await page
    .getByRole("button", { name: "Nova operação", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Nova operação",
    exact: true,
  });
  await expect(dialog.getByLabel("Cliente", { exact: true })).toContainText(
    NAME,
  );
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await dialog.getByLabel("Título", { exact: true }).fill("Visita no cliente");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(writes).toEqual([]);
  await page
    .getByRole("button", { name: "Nova operação", exact: true })
    .first()
    .click();
  await expect(dialog.getByLabel("Cliente", { exact: true })).toContainText(
    NAME,
  );
  const next = dialog.getByRole("button", { name: "Continuar", exact: true });
  await next.click();
  await expect(dialog.getByLabel("Título", { exact: true })).toHaveValue("");
  await expect(next).toBeDisabled();
  await dialog.getByLabel("Título", { exact: true }).fill("Visita no cliente");
  await next.click();
  await dialog
    .getByLabel("Início previsto", { exact: true })
    .fill("2026-10-22T09:00");
  await dialog
    .getByLabel("Término previsto", { exact: true })
    .fill("2026-10-22T08:00");
  await expect(next).toBeDisabled();
  await dialog
    .getByLabel("Término previsto", { exact: true })
    .fill("2026-10-22T10:00");
  await next.click();
  await dialog
    .getByLabel("Valor manual (R$)", { exact: true })
    .fill("1.250,50");
  await dialog
    .getByRole("checkbox", { name: "Mostrar o valor ao técnico em campo" })
    .check();
  await dialog.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(
    dialog.getByLabel("Início previsto", { exact: true }),
  ).toHaveValue("2026-10-22T09:00");
  await next.click();
  await expect(
    dialog.getByLabel("Valor manual (R$)", { exact: true }),
  ).toHaveValue("1.250,50");
  await next.click();
  await expect(
    dialog.getByRole("heading", { name: "Revisão", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/1\.250,50/)).toBeVisible();
  expect(writes).toEqual([]);
  await dialog
    .getByRole("button", { name: "Criar operação", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    writes.find((write) => write.path === "/api/orbit/operations")?.body
      .customerId,
  ).toBe(CUSTOMER);
  expect(
    writes.find((write) => write.path === "/api/orbit/operations")?.body,
  ).toMatchObject({
    manualAmount: 1250.5,
    amountVisibleInField: true,
    scheduledStart: "2026-10-22T12:00:00.000Z",
    scheduledEnd: "2026-10-22T13:00:00.000Z",
  });
  await expect(
    page.getByRole("link", { name: "Visita no cliente", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Operações/ })).toContainText(
    "1",
  );
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
});

test("creates a quote with the preselected customer and stays on its quotes tab", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page.getByRole("tab", { name: "Orçamentos", exact: true }).click();
  await page
    .getByRole("button", { name: "Novo orçamento", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Novo orçamento",
    exact: true,
  });
  const next = () =>
    dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await next();
  await expect(dialog.getByLabel("Cliente", { exact: true })).toContainText(
    NAME,
  );
  await dialog
    .getByLabel("Título", { exact: true })
    .fill("Orçamento no cliente");
  await next();
  await dialog.getByRole("tab", { name: "Item livre", exact: true }).click();
  await dialog.getByLabel("Descrição", { exact: true }).fill("Manutenção");
  await dialog.getByLabel("Valor unitário", { exact: true }).fill("100");
  await dialog.getByRole("button", { name: "Adicionar", exact: true }).click();
  await next();
  await next();
  await next();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: /Gerar orçamento/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(
    writes.find((write) => write.path === "/api/orbit/quotes")?.body.customerId,
  ).toBe(CUSTOMER);
  await expect(
    page.getByText("Orçamento no cliente", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${PATH}$`));
  await expect(
    page.getByRole("tab", { name: "Orçamentos", exact: true }),
  ).toHaveAttribute("data-state", "active");
});

test("copying a completed operation only searches the current customer's operations", async ({
  page,
}) => {
  const { copyQueries, writes } = await setup(page);
  await page.getByRole("tab", { name: "Orçamentos", exact: true }).click();
  await page
    .getByRole("button", { name: "Novo orçamento", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Novo orçamento",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: /A partir de um atendimento concluído/ })
    .click();
  await expect.poll(() => copyQueries.length).toBeGreaterThan(0);
  expect(
    copyQueries.every((query) => query.get("customerId") === CUSTOMER),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(writes).toEqual([]);
});

test("read-only users do not see either creation button", async ({ page }) => {
  await setup(page, true);
  await page.getByRole("tab", { name: /^Operações/ }).click();
  await expect(
    page.getByText("Nenhuma operação para este cliente", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nova operação", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("tab", { name: "Orçamentos", exact: true }).click();
  await expect(
    page.getByText("Nenhuma proposta para este cliente", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Novo orçamento", exact: true }),
  ).toHaveCount(0);
});

test("keeps the wizard draft after an API error and clears a saved manual value on edit", async ({
  page,
}) => {
  const { writes } = await setup(page, false, { failFirstOperation: true });
  await page.getByRole("tab", { name: /^Operações/ }).click();
  await page
    .getByRole("button", { name: "Nova operação", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Nova operação",
    exact: true,
  });
  const next = dialog.getByRole("button", { name: "Continuar", exact: true });
  await next.click();
  await dialog
    .getByLabel("Título", { exact: true })
    .fill("Atendimento com valor zero");
  const code = await dialog.getByLabel("Código", { exact: true }).inputValue();
  await next.click();
  await next.click();
  await dialog.getByLabel("Valor manual (R$)", { exact: true }).fill("-1");
  await expect(next).toBeDisabled();
  await dialog.getByLabel("Valor manual (R$)", { exact: true }).fill("0,00");
  await next.click();
  const save = dialog.getByRole("button", {
    name: "Criar operação",
    exact: true,
  });
  await save.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Voltar", exact: true }).click();
  await expect(
    dialog.getByLabel("Valor manual (R$)", { exact: true }),
  ).toHaveValue("0,00");
  await next.click();
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(
    writes
      .filter((write) => write.path === "/api/orbit/operations")
      .map((write) => write.body.manualAmount),
  ).toEqual([0, 0]);
  await page.goto("/operacoes");
  await page
    .getByRole("button", { name: `Ações da operação ${code}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Editar", exact: true }).click();
  const editing = page.getByRole("dialog", {
    name: `Editar ${code}`,
    exact: true,
  });
  await expect(
    editing.getByLabel("Valor manual (R$)", { exact: true }),
  ).toHaveValue("0");
  await editing.getByLabel("Valor manual (R$)", { exact: true }).fill("");
  await editing
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect(editing).toHaveCount(0);
  expect(
    writes.find((write) => write.path.endsWith("/operations/operation-new"))
      ?.body,
  ).toMatchObject({ manualAmount: null });
});

test("reuses address creation and checklist in the wizard on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const { writes } = await setup(page, false, { template: true });
  await page.getByRole("tab", { name: /^Operações/ }).click();
  await page
    .getByRole("button", { name: "Nova operação", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Nova operação",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Novo endereço", exact: true })
    .click();
  const address = page.getByRole("dialog", {
    name: "Novo endereço de atendimento",
    exact: true,
  });
  await address.getByLabel("Nome deste lugar", { exact: true }).fill("Matriz");
  await address.getByLabel("Logradouro", { exact: true }).fill("Rua da Aurora");
  await address.getByLabel("Número", { exact: true }).fill("100");
  await address.getByLabel("Cidade", { exact: true }).fill("Recife");
  await address
    .getByLabel("Complemento", { exact: true })
    .fill("Bloco B, sala 3");
  await address
    .getByLabel("Ponto de referência e acesso", { exact: true })
    .fill("Entrada ao lado da farmácia");
  await address.getByRole("button", { name: "Criar", exact: true }).click();
  await expect(address).toHaveCount(0);
  await expect(
    dialog.getByLabel("Endereço do atendimento", { exact: true }),
  ).toContainText("Matriz");
  await expect(
    dialog.getByText("Bloco B, sala 3", { exact: true }),
  ).toBeVisible();
  const next = dialog.getByRole("button", { name: "Continuar", exact: true });
  await next.click();
  await dialog
    .getByLabel("Título", { exact: true })
    .fill("Manutenção na matriz");
  await next.click();
  await next.click();
  await expect(
    dialog.getByText("Limpeza dos filtros", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Acrescentar item só para este atendimento", { exact: true })
    .fill("Conferir acesso ao bloco");
  await dialog.getByRole("button", { name: "Adicionar", exact: true }).click();
  await next.click();
  await expect(
    dialog.getByText("Entrada ao lado da farmácia", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Bloco B, sala 3", { exact: true }),
  ).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(box!.y + box!.height).toBeLessThanOrEqual(812);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/private/tmp/orbit-operation-wizard-mobile.png",
  });
  await dialog
    .getByRole("button", { name: "Criar operação", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(
      () =>
        writes.find((write) =>
          write.path.endsWith("/operations/operation-new/checklists"),
        )?.body,
    )
    .toMatchObject({
      templateId: "template-maintenance",
      additionalItems: [{ label: "Conferir acesso ao bloco" }],
    });
  expect(
    writes.find((write) => write.path === "/api/orbit/operations")?.body,
  ).toMatchObject({
    customerId: CUSTOMER,
    customerAddressId: "address-new",
    manualAmount: null,
    amountVisibleInField: false,
  });
});
