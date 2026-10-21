import { expect, test, type Page } from "@playwright/test";

const CUSTOMER = "01900000-0000-7000-8000-000000000001";
const PATH = `/clientes/${CUSTOMER}`;
const NAME = "Cliente da ficha";

/** Exercise the existing forms in the customer page, with isolated API fixtures. */
async function setup(page: Page, readOnly = false) {
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
      if (path === "/api/orbit/operations") {
        data = {
          ...body,
          id: "operation-new",
          status: "OPEN",
          users: [],
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
    } else if (path === "/api/auth/session") data = session;
    else if (path === `/api/orbit/customers/${CUSTOMER}`) data = customer;
    else if (path.endsWith("/addresses")) data = [];
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
  await dialog.getByLabel("Título", { exact: true }).fill("Visita no cliente");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(writes).toEqual([]);
  await page
    .getByRole("button", { name: "Nova operação", exact: true })
    .first()
    .click();
  await expect(dialog.getByLabel("Título", { exact: true })).toHaveValue("");
  await expect(dialog.getByLabel("Cliente", { exact: true })).toContainText(
    NAME,
  );
  await dialog.getByLabel("Título", { exact: true }).fill("Visita no cliente");
  await dialog
    .getByRole("button", { name: "Criar operação", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    writes.find((write) => write.path === "/api/orbit/operations")?.body
      .customerId,
  ).toBe(CUSTOMER);
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
