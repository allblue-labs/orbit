import { expect, test, type Page } from "@playwright/test";

/** UI-only fixtures: the navigation cookie and all API responses are synthetic. */
async function newAccount(
  page: Page,
  options: { dismissed?: boolean; failDismissal?: boolean } = {},
) {
  const profile = {
    id: "welcome-user",
    email: "owner@example.test",
    firstName: "Marina",
    lastName: "Silva",
    displayName: "Marina Silva",
    phone: null,
    avatarUrl: null,
    locale: "pt-BR",
    timezone: "America/Recife",
    status: "ACTIVE",
    emailVerifiedAt: null,
    mfaEnabled: false,
    mustChangePassword: false,
    createdAt: "2026-10-20T12:00:00Z",
    updatedAt: "2026-10-20T12:00:00Z",
    welcomeDismissedAt: options.dismissed ? "2026-10-20T12:00:00Z" : null,
  };
  const patches: unknown[] = [];
  const claims = {
    sub: profile.id,
    sid: "preview",
    type: "access",
    organizationId: "welcome-org",
    roles: [],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const token = `preview.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.preview`;
  await page.context().addCookies([
    {
      name: "orbit_access",
      value: token,
      url: test.info().project.use.baseURL as string,
    },
  ]);
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === "/api/auth/session") {
      data = {
        authenticated: true,
        user: profile,
        scope: {
          organizationId: "welcome-org",
          businessUnitId: null,
          businessUnitIds: [],
        },
        roles: [],
        permissions: ["*"],
        isOwner: true,
        surfaceAccess: ["WEB"],
        sessionId: "preview",
        expiresAt: null,
        organization: { id: "welcome-org", displayName: "Minha empresa" },
        businessUnits: [],
        organizations: [],
        entitlements: { capabilities: ["*"] },
        productAccess: null,
        isPlatformAdmin: false,
        subscriptionActive: true,
        subscriptionEndsAt: null,
        requiresPasswordChange: false,
      };
    } else if (path === "/api/orbit/identity/me") {
      if (route.request().method() === "PATCH") {
        patches.push(route.request().postDataJSON());
        if (options.failDismissal) {
          await route.fulfill({
            status: 503,
            json: {
              success: false,
              error: { code: "UNAVAILABLE", message: "Tente novamente." },
            },
          });
          return;
        }
        profile.welcomeDismissedAt = new Date().toISOString();
      }
      data = profile;
    } else if (path.endsWith("/identity/me/avatar")) {
      data = { available: false, url: null, expiresAt: null, updatedAt: null };
    } else if (path.endsWith("/identity/me/signature")) {
      data = {
        signatureAvailable: false,
        version: null,
        updatedAt: null,
        roles: [],
        preview: null,
      };
    } else if (path === "/api/orbit/dashboard") {
      data = {
        generatedAt: profile.createdAt,
        context: { segment: "HVAC_R" },
        layout: {
          widgets: [
            {
              id: "health-score",
              title: "Índice de Saúde",
              size: "MEDIUM",
              category: "EXECUTIVE",
              order: 30,
            },
          ],
        },
      };
    } else if (path === "/api/orbit/analytics/health") {
      data = {
        score: 0,
        status: "CRITICAL",
        availability: [],
        generatedAt: profile.createdAt,
        dimensions: [
          {
            id: "operations",
            label: "Operações",
            domain: "OPERATIONS",
            score: 0,
            weight: 0.3,
            hasData: false,
            drivers: [],
          },
          {
            id: "contracts",
            label: "Contratos",
            domain: "CONTRACTS",
            score: 0,
            weight: 0.15,
            hasData: false,
            drivers: [],
          },
        ],
      };
    } else if (path.includes("notifications")) {
      data = { unread: 0, data: [], meta: { page: 1, total: 0 } };
    }
    await route.fulfill({ json: { success: true, data } });
  });
  return patches;
}

test("first visit can be skipped, stays dismissed after reload and can be reopened", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const patches = await newAccount(page);
  await page.goto("/perfil");
  const guide = page.getByRole("dialog");
  await expect(guide.getByText("Olá, Marina!")).toBeVisible();
  await guide.screenshot({
    path: test.info().outputPath("welcome-desktop.png"),
  });
  await guide.getByRole("button", { name: "Pular e fazer depois" }).click();
  await expect(guide).toHaveCount(0);
  expect(patches).toEqual([{ dismissWelcome: true }]);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Configuração guiada" }),
  ).toBeVisible();
  await expect(guide).toHaveCount(0);
  await page.getByRole("button", { name: "Configuração guiada" }).click();
  await expect(guide.getByText("Olá, Marina!")).toBeVisible();
  expect(errors).toEqual([]);
});

test("reuses photo, signature and MFA controls in a mobile wizard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const patches = await newAccount(page);
  await page.goto("/perfil");
  const guide = page.getByRole("dialog");
  await guide.getByRole("button", { name: "Vamos começar" }).click();
  await expect(
    guide.getByRole("button", { name: "Enviar foto" }),
  ).toBeVisible();
  await guide.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    guide.getByRole("heading", { name: "Minha assinatura" }),
  ).toBeVisible();
  await guide.getByRole("button", { name: "Continuar", exact: true }).click();
  await expect(
    guide.getByRole("heading", { name: "Autenticação em dois fatores" }),
  ).toBeVisible();
  await expect(
    guide.getByRole("button", { name: "Configurar", exact: true }),
  ).toBeVisible();
  const bounds = await guide.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await guide.screenshot({
    path: test.info().outputPath("welcome-mobile.png"),
  });
  await guide.getByRole("button", { name: "Concluir", exact: true }).click();
  await expect(guide).toHaveCount(0);
  expect(patches).toEqual([{ dismissWelcome: true }]);
});

test("a failed save keeps the guide open and allows retry", async ({
  page,
}) => {
  await newAccount(page, { failDismissal: true });
  await page.goto("/perfil");
  const guide = page.getByRole("dialog");
  await guide.getByRole("button", { name: "Pular e fazer depois" }).click();
  await expect(
    guide.getByText("Tente novamente.", { exact: true }),
  ).toBeVisible();
  await expect(
    guide.getByRole("button", { name: "Pular e fazer depois" }),
  ).toBeEnabled();
});

test("an empty account shows unmeasured health instead of scores or a critical badge", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await newAccount(page, { dismissed: true });
  await page.goto("/dashboard");
  const health = page.locator('[data-panel="health-score"]');
  await expect(
    health.getByRole("heading", { name: "Índice de Saúde" }),
  ).toBeVisible();
  await expect(
    health.getByText("Ainda sem dados para avaliar.", { exact: true }),
  ).toHaveCount(2);
  await expect(health.getByText("—", { exact: true })).toHaveCount(3);
  await expect(health).not.toContainText(/crític/i);
  expect(errors).toEqual([]);
});
