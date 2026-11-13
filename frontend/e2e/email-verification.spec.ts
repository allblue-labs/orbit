import { expect, test, type Page } from "@playwright/test";

const TOKEN = "Ab3_".repeat(16);
async function setup(page: Page, failOnce = false) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const urls: string[] = [];
  let fail = failOnce;
  page.on("request", (request) => urls.push(request.url()));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session")
      return route.fulfill({ json: { authenticated: false } });
    if (path.endsWith("/identity/email/verify")) {
      writes.push({
        path,
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
      if (fail) {
        fail = false;
        return route.fulfill({
          status: 400,
          json: {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Link inválido, expirado ou já utilizado.",
            },
          },
        });
      }
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/identity/email/resend")) {
      writes.push({
        path,
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
      return route.fulfill({
        status: 202,
        json: {
          success: true,
          data: {
            message:
              "Se houver uma conta aguardando confirmação, enviaremos as instruções por e-mail.",
          },
        },
      });
    }
    return route.fulfill({ json: { success: true, data: [] } });
  });
  return { writes, urls };
}

test("somente a ação explícita confirma; o token não aparece nas URLs HTTP", async ({
  page,
}) => {
  const { writes, urls } = await setup(page);
  await page.goto(`/confirmar-email#token=${TOKEN}`);
  const button = page.getByRole("button", {
    name: "Confirmar meu e-mail",
    exact: true,
  });
  await expect(button).toBeVisible();
  expect(writes).toHaveLength(0);
  await button.click();
  await expect(
    page.getByRole("heading", { name: "E-mail confirmado!" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/confirmar-email$/);
  expect(writes).toEqual([
    { path: "/api/orbit/identity/email/verify", body: { token: TOKEN } },
  ]);
  expect(urls.some((url) => url.includes(TOKEN))).toBe(false);
  await expect(
    page.getByRole("link", { name: "Continuar para o Orbit" }),
  ).toHaveAttribute("href", "/login");
});

test("falha não consome o rascunho nem dispara tentativas automáticas", async ({
  page,
}) => {
  const { writes } = await setup(page, true);
  await page.goto(`/confirmar-email#token=${TOKEN}`);
  const button = page.getByRole("button", {
    name: "Confirmar meu e-mail",
    exact: true,
  });
  await button.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "O link pode ter expirado",
  );
  expect(writes).toHaveLength(1);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(
    page.getByRole("heading", { name: "E-mail confirmado!" }),
  ).toBeVisible();
  expect(writes).toHaveLength(2);
});

test("sem token oferece reenvio com resposta genérica em português", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page.goto("/confirmar-email");
  await expect(
    page.getByRole("button", { name: "Confirmar meu e-mail", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel(/^Seu e-mail(?:\s*\*?\s*\(obrigatório\))?$/)
    .fill("owner@example.test");
  await page
    .getByRole("button", { name: "Solicitar novo e-mail", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Se houver uma conta aguardando confirmação",
  );
  expect(writes).toEqual([
    {
      path: "/api/orbit/identity/email/resend",
      body: { email: "owner@example.test" },
    },
  ]);
});
