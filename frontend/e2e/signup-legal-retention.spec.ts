import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function addressStep(page: Page) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ json: { success: true, data: { authenticated: false } } }),
  );
  await page.goto("/cadastro?plano=PROFESSIONAL");
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
}

test("UF starts empty and is filled from the selected CEP", async ({
  page,
}) => {
  await page.route("**/api/cep/40020000", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          postalCode: "40020-000",
          street: "Rua da Misericórdia",
          district: "Centro",
          city: "Salvador",
          state: "Bahia",
          stateCode: "BA",
          country: "Brasil",
        },
      },
    }),
  );
  await addressStep(page);
  await expect(page.getByLabel("UF", { exact: true })).toHaveValue("");
  await page.getByLabel("CEP", { exact: true }).fill("40020000");
  await expect(page.getByLabel("UF", { exact: true })).toHaveValue("BA");
  await expect(page.getByLabel("Cidade", { exact: true })).toHaveValue(
    "Salvador",
  );
});

test("reading both full documents preserves the signup form and does not accept on behalf of the user", async ({
  page,
}) => {
  await addressStep(page);
  await page.getByLabel("Cidade", { exact: true }).fill("Salvador");
  for (const [label, title] of [
    ["Termos de Uso", "Termos de Uso do Orbit"],
    ["Política de Privacidade", "Política de Privacidade do Orbit"],
  ]) {
    await page
      .getByRole("button", { name: `Ler ${label}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const frame = page.frameLocator(`iframe[title="${label}"]`);
    await expect(
      frame.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      frame.getByText("Allblue Labs Inova Simples", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      frame.getByRole("link", { name: "contato@allblue-labs.com" }),
    ).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.width).toBeGreaterThan(700);
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  }
  await expect(page.getByLabel("Cidade", { exact: true })).toHaveValue(
    "Salvador",
  );
  await expect(page.locator("#terms")).not.toBeChecked();
});

for (const slug of ["termos", "privacidade"]) {
  test(`the public ${slug} page downloads the complete PDF without login`, async ({
    page,
  }) => {
    await page.goto(`/legal/${slug}`);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Baixar PDF", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`orbit-${slug}-2026-10-23.1.pdf`);
    const content = await readFile((await download.path())!);
    expect(content.subarray(0, 5).toString()).toBe("%PDF-");
    expect(content.length).toBeGreaterThan(6000);
  });
}

test("legal reading fits a mobile screen", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await addressStep(page);
  await page
    .getByRole("button", { name: "Ler Termos de Uso", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Termos de Uso"]')
      .getByRole("heading", { name: "Termos de Uso do Orbit", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test.describe("aceite obrigatório em português", () => {
  // The app must show its Portuguese validation even in an English browser.
  test.use({ locale: "en-US" });
  const message =
    "Para continuar, aceite os Termos de Uso e confirme a leitura da Política de Privacidade.";

  for (const action of ["clique", "Enter"] as const) {
    test(`avisa por ${action} e só envia o cadastro após o aceite`, async ({
      page,
    }) => {
      const registrations: Record<string, unknown>[] = [];
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.route("**/api/auth/register", async (route) => {
        registrations.push(
          route.request().postDataJSON() as Record<string, unknown>,
        );
        // Intercept the submission; this test must never create a real account.
        await route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "REGISTRATION_CONFLICT",
              message: "Cadastro de teste interceptado.",
            },
          },
        });
      });
      if (action === "Enter")
        await page.setViewportSize({ width: 390, height: 844 });
      await addressStep(page);
      await page.getByLabel("Cidade", { exact: true }).fill("Salvador");
      await page.getByLabel("UF", { exact: true }).fill("BA");
      const street = page.getByLabel("Endereço da matriz", { exact: true });
      await street.fill("Rua da Misericórdia, 100");
      if (action === "Enter") await street.press("Enter");
      else
        await page
          .getByRole("button", { name: "Criar organização", exact: true })
          .click();

      const terms = page.locator("#terms");
      await expect(page.locator("#terms-error")).toHaveText(message);
      await expect(page.locator("[data-sonner-toast]")).toContainText(message);
      await expect(terms).toHaveAttribute("aria-invalid", "true");
      await expect(terms).toHaveAttribute("aria-describedby", "terms-error");
      await expect(terms).toBeFocused();
      expect(registrations).toHaveLength(0);

      await terms.check();
      await expect(terms).toHaveAttribute("aria-invalid", "false");
      await expect(page.locator("#terms-error")).toHaveCount(0);
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
      const submitted = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth/register") &&
          response.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Criar organização", exact: true })
        .click();
      expect((await submitted).status()).toBe(503);
      expect(registrations).toHaveLength(1);
      expect(registrations[0].acceptTerms).toBe(true);
      expect(pageErrors).toEqual([]);
    });
  }
});
