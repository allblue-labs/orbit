import { LEGAL_DOCUMENT_VERSION } from "../src/types/contracts/modules/legal/legal.read-models";
import { expect, test, type Page } from "@playwright/test";

async function completeSignup(
  page: Page,
  address?: { number: string; complement: string },
) {
  await page.goto("/cadastro?plano=PROFESSIONAL&periodicidade=ANNUAL");
  for (const [label, value] of [
    ["Nome", "Marina"],
    ["Sobrenome", "Silva"],
    ["E-mail corporativo", "owner@example.test"],
    ["Senha", "Orbit#Signup2026"],
    ["Confirmar senha", "Orbit#Signup2026"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByLabel(/^Nome da organização(?:\s*\*?\s*\(obrigatório\))?$/)
    .fill("Minha empresa");
  await page
    .getByLabel(/^Razão social(?:\s*\*?\s*\(obrigatório\))?$/)
    .fill("Minha empresa Ltda");
  await page.locator("#documentNumber").fill("52998224725");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel(/^UF(?:\s*\*?\s*\(obrigatório\))?$/).fill("PE");
  await page.getByLabel(/^Cidade(?:\s*\*?\s*\(obrigatório\))?$/).fill("Recife");
  await page
    .getByLabel(/^Endereço da matriz(?:\s*\*?\s*\(obrigatório\))?$/)
    .fill("Rua da Aurora, 100");
  if (address) {
    await page.locator("#number").fill(address.number);
    await page.locator("#complement").fill(address.complement);
  }
  await page.locator("#terms").check();
  await page.getByRole("button", { name: /Criar/ }).click();
}

for (const conflict of [
  {
    code: "REGISTRATION_DOCUMENT_ALREADY_EXISTS",
    field: "#documentNumber",
    value: "529.982.247-25",
    nextValue: "11144477735",
    message:
      "Este CPF ou CNPJ já está vinculado a uma conta do Orbit. Entre na conta existente para cadastrar outras organizações conforme seu plano.",
    signIn: true,
  },
  {
    code: "REGISTRATION_EMAIL_ALREADY_EXISTS",
    field: "#email",
    value: "owner@example.test",
    nextValue: "other@example.test",
    message:
      "Este e-mail já está cadastrado no Orbit. Entre na sua conta ou recupere a senha.",
    signIn: true,
  },
  {
    code: "REGISTRATION_ORGANIZATION_NAME_UNAVAILABLE",
    field: "#organizationName",
    value: "Minha empresa",
    nextValue: "Minha empresa Recife",
    message:
      "Já existe uma conta com este nome de organização. Informe outro nome para continuar; a razão social pode ser mantida.",
    signIn: false,
  },
]) {
  test(`signup explains ${conflict.code} beside the field and preserves the other steps`, async ({
    page,
  }) => {
    const writes: string[] = [];
    await page.route("**/api/auth/session", (route) =>
      route.fulfill({
        json: { success: true, data: { authenticated: false } },
      }),
    );
    await page.route("**/api/auth/register", async (route) => {
      writes.push(route.request().url());
      await route.fulfill({
        status: 409,
        json: {
          success: false,
          error: {
            code: conflict.code,
            message: conflict.message,
            status: 409,
          },
        },
      });
    });
    await completeSignup(page);
    await expect(page.locator(conflict.field)).toHaveValue(conflict.value);
    await expect(
      page.getByRole("alert").filter({ hasText: conflict.message }).first(),
    ).toBeVisible();
    await expect(
      page.getByText(conflict.message, { exact: true }).first(),
    ).toBeVisible();
    if (conflict.signIn)
      await expect(
        page.getByRole("link", { name: "Entrar na minha conta", exact: true }),
      ).toHaveAttribute("href", "/login");
    expect(writes.length).toBe(1);
    await page.locator(conflict.field).fill(conflict.nextValue);
    if (conflict.code === "REGISTRATION_EMAIL_ALREADY_EXISTS")
      await page.locator(conflict.field).press("Enter");
    else
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .click();
    if (conflict.code === "REGISTRATION_EMAIL_ALREADY_EXISTS") {
      await expect(
        page.getByLabel(/^Razão social(?:\s*\*?\s*\(obrigatório\))?$/),
      ).toHaveValue("Minha empresa Ltda");
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .click();
    }
    await expect(
      page.getByLabel(/^Cidade(?:\s*\*?\s*\(obrigatório\))?$/),
    ).toHaveValue("Recife");
    await expect(
      page.getByLabel(/^UF(?:\s*\*?\s*\(obrigatório\))?$/),
    ).toHaveValue("PE");
    await expect(page.locator("#terms")).toBeChecked();
    await expect(
      page.locator('[aria-label="Plano selecionado"]'),
    ).toContainText("Profissional · Anual");
    expect(writes.length).toBe(1);
  });
}

test("optional address reaches signup and the wizard waits for confirmation without checkout or portal access", async ({
  page,
}) => {
  let body: Record<string, unknown> = {},
    billingCalls = 0;
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { success: true, data: { authenticated: false } } }),
  );
  await page.route("**/api/orbit/billing/**", (route) => {
    billingCalls++;
    return route.fulfill({ status: 500 });
  });
  await page.route("**/api/auth/register", async (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      json: {
        success: true,
        data: {
          authenticated: false,
          status: "EMAIL_VERIFICATION_REQUIRED",
          email: body.email,
        },
      },
    });
  });
  await completeSignup(page, { number: "42A", complement: "Sala 6" });
  await expect(
    page.getByRole("heading", { name: "Confirme seu e-mail" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Seu e-mail" })).toHaveValue(
    "owner@example.test",
  );
  expect(body).toMatchObject({
    number: "42A",
    complement: "Sala 6",
    planKey: "PROFESSIONAL",
    billingInterval: "ANNUAL",
    acceptTerms: true,
    termsVersion: LEGAL_DOCUMENT_VERSION,
    privacyVersion: LEGAL_DOCUMENT_VERSION,
  });
  expect(billingCalls).toBe(0);
  await expect(page).toHaveURL(/\/cadastro/);
});

test("real registration BFF never persists access or refresh cookies before confirmation", async ({
  page,
  baseURL,
}) => {
  const headers = {
    origin: new URL(baseURL!).origin,
    "sec-fetch-site": "same-origin",
  };
  const suffix = Date.now().toString() + Math.random().toString(36).slice(2, 8);
  const digits = Array.from({ length: 9 }, () =>
    Math.floor(Math.random() * 10),
  );
  for (let len = 9; len <= 10; len++) {
    const value =
      (digits.reduce((sum, n, i) => sum + n * (len + 1 - i), 0) * 10) % 11;
    digits.push(value === 10 ? 0 : value);
  }
  const response = await page.request.post("/api/auth/register", {
    headers,
    data: {
      email: `browser.pending.${suffix}@example.test`,
      password: "Orbit#Pending2026",
      firstName: "Owner",
      lastName: "Pendente",
      organizationName: `Browser Pending ${suffix}`,
      legalName: "Browser Pending Ltda",
      documentType: "CPF",
      documentNumber: digits.join(""),
      primarySegment: "HVAC_R",
      city: "Recife",
      street: "Rua de teste",
      number: "42A",
      complement: "Sala 6",
      stateCode: "PE",
      planKey: "PROFESSIONAL",
      billingInterval: "ANNUAL",
      acceptTerms: true,
      termsVersion: LEGAL_DOCUMENT_VERSION,
      privacyVersion: LEGAL_DOCUMENT_VERSION,
    },
  });
  expect(response.status()).toBe(201);
  expect((await response.json()).data).toMatchObject({
    authenticated: false,
    status: "EMAIL_VERIFICATION_REQUIRED",
  });
  expect(
    (await page.context().cookies()).filter((c) =>
      ["orbit_access", "orbit_refresh"].includes(c.name),
    ),
  ).toHaveLength(0);
  const session = await page.request.get("/api/auth/session", { headers });
  expect((await session.json()).data).toMatchObject({ authenticated: false });
});

test("unverified owner login opens the confirmation action rather than the portal", async ({
  page,
}) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { success: true, data: { authenticated: false } } }),
  );
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 401,
      json: {
        success: false,
        error: {
          code: "EMAIL_VERIFICATION_REQUIRED",
          message: "Confirme seu e-mail para liberar o acesso ao Orbit.",
          status: 401,
        },
      },
    }),
  );
  await page.goto("/login");
  await page
    .getByLabel("E-mail corporativo", { exact: true })
    .fill("owner@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("Orbit#Pending2026");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Confirme seu e-mail" }),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Seu e-mail" })).toHaveValue(
    "owner@example.test",
  );
  await expect(page).toHaveURL(/\/login/);
});
