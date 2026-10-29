import { expect, test, type Page } from "@playwright/test";

const NAME = "Zênite Serviços";
const DOCUMENT = "11222333000181";
const CUSTOMER = "01900000-0000-7000-8000-000000000120";
const PERSON = "01900000-0000-7000-8000-000000000121";
interface PickerCustomer {
  id: string;
  type: string;
  legalName: string;
  tradeName: null;
  documentNumber: string;
  status: string;
  address: Record<string, string> | null;
}

async function setup(page: Page) {
  const unit = { id: "unit", legalName: "Matriz", timezone: "America/Recife" };
  const customers: PickerCustomer[] = Array.from({ length: 120 }, (_, i) => ({
    id: `customer-${i}`,
    type: "COMPANY",
    legalName: `Cliente ${String(i).padStart(3, "0")}`,
    tradeName: null,
    documentNumber: `9000000000${String(i).padStart(4, "0")}`,
    status: "ACTIVE",
    address: null,
  }));
  customers.push(
    {
      ...customers[0],
      id: CUSTOMER,
      legalName: NAME,
      documentNumber: DOCUMENT,
      address: { street: "Rua do Sol", city: "Recife", stateCode: "PE" },
    },
    {
      ...customers[0],
      id: PERSON,
      legalName: "Maria Silva",
      type: "PERSON",
      documentNumber: "52998224725",
    },
  );
  const session = {
    authenticated: true,
    user: {
      id: "owner",
      displayName: "Marina",
      email: "owner@example.test",
      welcomeDismissedAt: "2026-10-01T12:00:00Z",
    },
    scope: {
      organizationId: "org",
      businessUnitId: "unit",
      businessUnitIds: ["unit"],
    },
    isOwner: true,
    roles: ["OWNER"],
    permissions: ["*"],
    organization: { id: "org", displayName: "Empresa" },
    businessUnits: [unit],
    organizations: [],
    entitlements: { capabilities: ["*"] },
    productAccess: null,
    isPlatformAdmin: false,
    subscriptionActive: true,
    requiresPasswordChange: false,
  };
  const claims = {
    sub: "owner",
    sid: "fixture",
    type: "access",
    organizationId: "org",
    roles: ["OWNER"],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  await page.context().addCookies([
    {
      name: "orbit_access",
      value: `fixture.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`,
      url: test.info().project.use.baseURL as string,
    },
  ]);
  const queries: URLSearchParams[] = [];
  const paths: string[] = [];
  let unavailable = false;
  const paginate = (
    data: unknown[],
    page = 1,
    limit = 20,
    total = data.length,
  ) => ({
    data,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNextPage: page * limit < total,
      hasPreviousPage: page > 1,
    },
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    paths.push(url.pathname);
    let data: unknown = paginate([]);
    if (url.pathname === "/api/auth/session") {
      await route.fulfill({ json: session });
      return;
    }
    if (url.pathname === "/api/orbit/customers") {
      queries.push(url.searchParams);
      if (unavailable) {
        await route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Não foi possível consultar os clientes agora.",
            },
          },
        });
        return;
      }
      const search = (url.searchParams.get("search") ?? "")
        .trim()
        .toLowerCase();
      const digits = /^[\d./\s-]+$/.test(search)
        ? search.replace(/\D/g, "")
        : "";
      const matches = customers.filter(
        (customer) =>
          !search ||
          customer.legalName.toLowerCase().includes(search) ||
          (digits && customer.documentNumber.includes(digits)),
      );
      const current = Number(url.searchParams.get("page") ?? 1);
      const limit = Number(url.searchParams.get("limit") ?? 20);
      data = paginate(
        matches.slice((current - 1) * limit, current * limit),
        current,
        limit,
        matches.length,
      );
    } else if (url.pathname.endsWith("/addresses")) data = [];
    else if (url.pathname.includes("maintenance-types")) data = [];
    else if (url.pathname === "/api/orbit/organizations/current")
      data = { id: "org", displayName: "Empresa", businessUnits: [unit] };
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto("/rvt");
  await page
    .getByRole("button", { name: "Nova visita técnica" })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Nome do atendimento *", { exact: true })
    .fill("Visita preventiva");
  return {
    queries,
    paths,
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
  };
}

for (const [term, label, id] of [
  ["Zênite", NAME, CUSTOMER],
  ["11.222.333/0001-81", NAME, CUSTOMER],
  [DOCUMENT, NAME, CUSTOMER],
  ["529.982.247-25", "Maria Silva", PERSON],
]) {
  test(`RVT localiza e seleciona cliente por ${term}`, async ({ page }) => {
    const state = await setup(page);
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Continuar", exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole("combobox", { name: "Cliente *", exact: true })
      .click();
    await page.getByLabel("Buscar cliente", { exact: true }).fill(term);
    await expect
      .poll(() => state.queries.some((query) => query.get("search") === term))
      .toBe(true);
    await page.getByRole("button", { name: new RegExp(label) }).click();
    await expect(
      dialog.getByRole("combobox", { name: "Cliente *", exact: true }),
    ).toHaveText(label);
    await dialog
      .getByRole("button", { name: "Continuar", exact: true })
      .click();
    await expect(dialog.getByLabel("Buscar equipamento")).toBeVisible();
    await expect
      .poll(() => state.paths.includes(`/api/orbit/customers/${id}/addresses`))
      .toBe(true);
  });
}

test("RVT permite escolher clientes além dos primeiros 100 e preserva a escolha ao mudar a busca", async ({
  page,
}) => {
  const state = await setup(page);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Cliente *", exact: true })
    .click();
  const results = page.getByRole("group", { name: "Clientes encontrados" });
  await expect(async () => {
    await results.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByRole("button", { name: new RegExp(NAME) }),
    ).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20000 });
  await page.getByRole("button", { name: new RegExp(NAME) }).click();
  expect(state.queries.some((query) => Number(query.get("page")) > 5)).toBe(
    true,
  );
  await dialog
    .getByRole("combobox", { name: "Cliente *", exact: true })
    .click();
  await page.getByLabel("Buscar cliente").fill("Cliente inexistente");
  await expect(
    page.getByText("Nenhum cliente encontrado.", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Cliente *", exact: true }),
  ).toHaveText(NAME);
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    dialog.getByLabel("Rua / logradouro *", { exact: true }),
  ).toHaveValue("Rua do Sol");
});

test("falha na busca não aparece como cliente inexistente e permite tentar novamente", async ({
  page,
}) => {
  const state = await setup(page);
  state.setUnavailable(true);
  await page.getByRole("combobox", { name: "Cliente *", exact: true }).click();
  await expect(
    page.getByText("Não foi possível carregar os clientes.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Nenhum cliente encontrado.", { exact: true }),
  ).toHaveCount(0);
  state.setUnavailable(false);
  await page
    .getByRole("button", { name: "Tentar novamente", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Clientes encontrados" }),
  ).toBeVisible();
});
