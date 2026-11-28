import { test, expect } from "@playwright/test";
for (const route of ["redefinir-senha", "convite"]) {
  for (const separator of ["#", "?"]) {
    test(`${route}: ${separator === "#" ? "private fragment" : "legacy query"} survives URL scrubbing`, async ({
      page,
    }) => {
      const token = "MAIL_LINK_PRIVATE_CANARY";
      const documents: string[] = [];
      page.on("request", (request) => {
        if (request.resourceType() === "document")
          documents.push(request.url());
      });
      if (route === "redefinir-senha") {
        await page.route(
          "**/api/orbit/identity/password/reset/validate",
          (route) => route.fulfill({ status: 204 }),
        );
      }
      const response = await page.goto(`/${route}${separator}token=${token}`);
      expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
      await expect(
        page.getByLabel(route === "convite" ? "Nome" : "Nova senha", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page).not.toHaveURL(/token=/);
      await expect(
        page.getByText("Link inválido", { exact: true }),
      ).not.toBeVisible();
      if (separator === "#")
        expect(documents.every((url) => !url.includes(token))).toBe(true);
      if (route === "redefinir-senha") {
        let sent = "";
        await page.route(
          "**/api/orbit/identity/password/reset",
          async (route) => {
            sent = (route.request().postDataJSON() as { token: string }).token;
            await route.fulfill({ status: 204 });
          },
        );
        await page
          .getByLabel("Nova senha", { exact: true })
          .fill("Orbit#Email@Test2026");
        await page
          .getByLabel("Confirme a nova senha", { exact: true })
          .fill("Orbit#Email@Test2026");
        await page.getByRole("button", { name: "Salvar nova senha" }).click();
        await expect.poll(() => sent).toBe(token);
      }
    });
  }
}

const invalidReset = {
  success: false,
  error: {
    code: "PASSWORD_RESET_INVALID",
    message:
      "Este link de recuperação é inválido, expirou ou já foi utilizado. Solicite um novo link.",
  },
};

test("a senha salva encerra o formulário e reabrir o mesmo link mostra que ele foi utilizado", async ({
  page,
}) => {
  let used = false;
  let submissions = 0;
  await page.route("**/api/orbit/identity/password/reset/validate", (route) =>
    used
      ? route.fulfill({ status: 400, json: invalidReset })
      : route.fulfill({ status: 204 }),
  );
  await page.route("**/api/orbit/identity/password/reset", async (route) => {
    submissions++;
    used = true;
    await route.fulfill({ status: 204 });
  });
  const link = "/redefinir-senha#token=MAIL_LINK_PRIVATE_CANARY";
  await page.goto(link);
  await page
    .getByLabel("Nova senha", { exact: true })
    .fill("Orbit#Email@Test2026");
  await page
    .getByLabel("Confirme a nova senha", { exact: true })
    .fill("Orbit#Email@Test2026");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(
    page.getByRole("heading", { name: "Senha atualizada", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Este link já foi utilizado e não permite novas alterações de senha.",
    ),
  ).toBeVisible();
  await expect(
    page.getByLabel("Nova senha", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "Entrar com a nova senha" }),
  ).toBeVisible();
  // A fresh page represents reopening the email, rather than hash navigation
  // in the already completed form (which correctly keeps its success state).
  await page.goto("/login");
  await page.goto(link);
  await expect(
    page.getByText("Link inválido ou já utilizado", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Nova senha", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "Solicitar novo link" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/token=/);
  expect(submissions).toBe(1);
});

test("a API real recusa um link inexistente pelo BFF sem exigir login", async ({
  page,
}) => {
  const checks: number[] = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/identity/password/reset/validate"))
      checks.push(response.status());
  });
  await page.goto(`/redefinir-senha#token=${"x".repeat(64)}`);
  await expect(
    page.getByText("Link inválido ou já utilizado", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("O link expira em até 3 horas", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Nova senha", { exact: true }),
  ).not.toBeVisible();
  expect(checks).toContain(400);
});

test("um link consumido em outra aba é recusado ao salvar sem exibir sucesso", async ({
  page,
}) => {
  await page.route("**/api/orbit/identity/password/reset/validate", (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route("**/api/orbit/identity/password/reset", (route) =>
    route.fulfill({ status: 400, json: invalidReset }),
  );
  await page.goto("/redefinir-senha#token=MAIL_LINK_PRIVATE_CANARY");
  await page
    .getByLabel("Nova senha", { exact: true })
    .fill("Orbit#Email@Test2026");
  await page
    .getByLabel("Confirme a nova senha", { exact: true })
    .fill("Orbit#Email@Test2026");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(
    page.getByText("Link inválido ou já utilizado", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Senha atualizada", exact: true }),
  ).not.toBeVisible();
});

test("falha transitória ao verificar permite tentar novamente sem consumir o link", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/orbit/identity/password/reset/validate", (route) => {
    calls++;
    return calls === 1
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({ status: 204 });
  });
  await page.goto("/redefinir-senha#token=MAIL_LINK_PRIVATE_CANARY");
  await expect(
    page.getByText("Não foi possível verificar o link", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Verificar novamente" }).click();
  await expect(page.getByLabel("Nova senha", { exact: true })).toBeVisible();
});
