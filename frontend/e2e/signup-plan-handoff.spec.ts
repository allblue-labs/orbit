import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { success: true, data: { authenticated: false } } }),
  );
});

for (const origin of ["/", "/planos"]) {
  test(`the chosen annual plan goes directly to the account form from ${origin}`, async ({
    page,
  }) => {
    await page.goto(origin);
    const pricing =
      origin === "/" ? page.locator("#planos") : page.locator("main");
    await pricing.getByRole("tab", { name: "Anual", exact: true }).click();
    await pricing
      .getByRole("article", { name: "Profissional", exact: true })
      .getByRole("link", { name: "Começar agora", exact: true })
      .click();
    await expect(page).toHaveURL(
      /\/cadastro\?plano=PROFESSIONAL&periodicidade=ANNUAL/,
    );
    await expect(
      page.getByRole("heading", { name: "Sua conta", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Nome", { exact: true })).toBeVisible();
    const summary = page.locator('[aria-label="Plano selecionado"]');
    await expect(summary).toContainText("Profissional · Anual");
    await expect(summary).toContainText(/1\.499,00.*por ano/);
  });
}

for (const query of [
  "",
  "?plano=INTERNAL",
  "?plano=PROFESSIONAL&periodicidade=INVALID",
  "?plano=PROFESSIONAL&plano=ESSENTIAL",
]) {
  test(`unselected or invalid plan does not skip selection: ${query || "direct signup"}`, async ({
    page,
  }) => {
    await page.goto(`/cadastro${query}`);
    await expect(
      page.getByRole("heading", { name: "Escolha do plano", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Profissional Plano para/ }).first(),
    ).toBeVisible();
  });
}

test("changing the preselected plan preserves account data", async ({
  page,
}) => {
  await page.goto("/cadastro?plano=PROFESSIONAL");
  await page.getByLabel("Nome", { exact: true }).fill("Marina");
  await page
    .getByRole("button", { name: "Alterar plano", exact: true })
    .click();
  await page.getByRole("tab", { name: "Semestral", exact: true }).click();
  await page
    .getByRole("button", { name: /Profissional \+ Inteligência Plano para/ })
    .click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Marina");
  await expect(page.locator('[aria-label="Plano selecionado"]')).toContainText(
    "Profissional + Inteligência · Semestral",
  );
});

test("the registration request preserves the paid plan and billing interval", async ({
  page,
}) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/auth/register", async (route) => {
    writes.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 400,
      json: {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Resposta simulada para conferir o envio.",
        },
      },
    });
  });
  await page.goto("/cadastro?plano=PROFESSIONAL&periodicidade=ANNUAL");
  await page.getByLabel("Nome", { exact: true }).fill("Marina");
  await page.getByLabel("Sobrenome", { exact: true }).fill("Silva");
  await page
    .getByLabel("E-mail corporativo", { exact: true })
    .fill("owner@example.test");
  await page.getByLabel("Senha", { exact: true }).fill("Orbit#Signup2026");
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("Orbit#Signup2026");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page
    .getByLabel("Nome da organização", { exact: true })
    .fill("Empresa do cadastro");
  await page
    .getByLabel("Razão social", { exact: true })
    .fill("Empresa do cadastro Ltda");
  await page.locator("#documentNumber").fill("52998224725");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("Cidade", { exact: true }).fill("Recife");
  await page
    .getByLabel("Endereço da matriz", { exact: true })
    .fill("Rua da Aurora, 100");
  await page.locator("#terms").check();
  expect(writes).toEqual([]);
  await page.getByRole("button", { name: /Criar/ }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    planKey: "PROFESSIONAL",
    billingInterval: "ANNUAL",
    city: "Recife",
    documentNumber: "52998224725",
  });
});

test("the preselected plan fits a mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(
    "/cadastro?plano=PROFESSIONAL_INTELLIGENCE&periodicidade=SEMIANNUAL",
  );
  await expect(
    page.getByRole("heading", { name: "Sua conta", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[aria-label="Plano selecionado"]')).toContainText(
    "Profissional + Inteligência · Semestral",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
