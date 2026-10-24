import { expect, test, type Page } from "@playwright/test";

async function completeSignup(page: Page) {
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
    .getByLabel("Nome da organização", { exact: true })
    .fill("Minha empresa");
  await page
    .getByLabel("Razão social", { exact: true })
    .fill("Minha empresa Ltda");
  await page.locator("#documentNumber").fill("52998224725");
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByLabel("UF", { exact: true }).fill("PE");
  await page.getByLabel("Cidade", { exact: true }).fill("Recife");
  await page
    .getByLabel("Endereço da matriz", { exact: true })
    .fill("Rua da Aurora, 100");
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
        page.getByLabel("Razão social", { exact: true }),
      ).toHaveValue("Minha empresa Ltda");
      await page
        .getByRole("button", { name: "Continuar", exact: true })
        .click();
    }
    await expect(page.getByLabel("Cidade", { exact: true })).toHaveValue(
      "Recife",
    );
    await expect(page.getByLabel("UF", { exact: true })).toHaveValue("PE");
    await expect(page.locator("#terms")).toBeChecked();
    await expect(
      page.locator('[aria-label="Plano selecionado"]'),
    ).toContainText("Profissional · Anual");
    expect(writes.length).toBe(1);
  });
}
