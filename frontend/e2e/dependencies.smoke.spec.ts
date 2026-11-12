import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";

test.describe("dependências do standalone", () => {
  test("renderiza, hidrata e navega entre planos e cadastro com imagem otimizada", async ({
    page,
    request,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/planos");
    await expect(
      page.getByRole("heading", {
        name: "Planos para cada tamanho de operação",
      }),
    ).toBeVisible();
    await page
      .getByRole("article", { name: "Profissional", exact: true })
      .getByRole("link", { name: "Começar agora" })
      .click();
    await expect(page).toHaveURL(/cadastro\?plano=PROFESSIONAL/);
    await expect(
      page.getByRole("heading", { name: "Sua conta", exact: true }),
    ).toBeVisible();
    const image = await request.get(
      "/_next/image?url=%2Forbit_logo.png&w=640&q=75",
      { headers: { accept: "image/webp" } },
    );
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toMatch(/^image\//);
    expect((await image.body()).length).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });

  test("mantém o BFF público, os cookies seguros e a recusa de origem externa", async ({
    request,
    baseURL,
  }) => {
    const headers = { origin: baseURL!, "sec-fetch-site": "same-origin" };
    const anonymous = await request.get("/api/auth/session", { headers });
    expect(anonymous.status()).toBe(200);
    expect((await anonymous.json()).data.authenticated).toBe(false);
    const login = await request.post("/api/auth/login", {
      headers,
      data: {
        email: "smoke@example.test",
        password: "SyntheticSmokeOnly!2026",
      },
    });
    expect(login.status()).toBe(200);
    expect(await login.json()).toMatchObject({
      success: true,
      data: { authenticated: true },
    });
    const cookies = login
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .map((header) => header.value);
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=lax/i);
    }
    // HTTP is isolated test transport; manually forwarding cookies does not qualify real TLS/browser persistence.
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    const session = await request.get("/api/auth/session", {
      headers: { ...headers, cookie },
    });
    expect((await session.json()).data).toMatchObject({
      authenticated: true,
      user: { id: "dependency-smoke-user" },
    });
    expect(JSON.stringify(await session.json())).not.toContain(
      "synthetic-refresh-token",
    );
    const forbidden = await request.post("/api/auth/logout", {
      headers: { ...headers, origin: "https://untrusted.example", cookie },
    });
    expect(forbidden.status()).toBe(403);
    const logout = await request.post("/api/auth/logout", {
      headers: { ...headers, cookie },
    });
    expect(logout.status()).toBe(200);
    const cleared = logout
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie");
    expect(cleared).toHaveLength(2);
    expect(
      cleared.every((header) => /expires=Thu, 01 Jan 1970/i.test(header.value)),
    ).toBe(true);
  });

  test("coleta assinatura e atualiza o aceite público pelo BFF", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const document = await page.goto(
      `/proposta/${randomBytes(48).toString("base64url")}`,
    );
    expect(document?.headers()["referrer-policy"]).toBe("no-referrer");
    await expect(
      page.getByRole("heading", { name: "Manutenção de teste", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Baixar orçamento em PDF",
        exact: true,
      }),
    ).toBeVisible();
    await page.locator("#customer-name").fill("Pessoa de teste");
    await page.locator("canvas").scrollIntoViewIfNeeded();
    const bounds = await page.locator("canvas").boundingBox();
    expect(bounds).not.toBeNull();
    await page.mouse.move(bounds!.x + 30, bounds!.y + 35);
    await page.mouse.down();
    await page.mouse.move(bounds!.x + 120, bounds!.y + 55, { steps: 12 });
    await page.mouse.up();
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Assinar e aprovar orçamento", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Orçamento aprovado e assinatura registrada",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Baixar orçamento assinado em PDF",
        exact: true,
      }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
