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
