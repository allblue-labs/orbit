import { expect, test, type Page } from "@playwright/test";
import type { BillingOverview } from "../src/types/billing";

const period = {
  start: new Date().toISOString(),
  end: new Date(Date.now() + 20 * 86400000).toISOString(),
};
const plans = [
  ["ESSENTIAL", "Essencial", 5990],
  ["PROFESSIONAL", "Profissional", 14990],
  ["PROFESSIONAL_INTELLIGENCE", "Profissional + Inteligência", 24990],
  ["ENTERPRISE_UNLIMITED", "Empresarial Ilimitado", 69990],
].map(([code, label, amount]) => ({
  code: String(code),
  label: String(label),
  description: "Plano para a operação",
  monthlyPrice: String(Number(amount) / 100),
  currency: "BRL",
  capabilities: [],
  allocation: {},
  usage: {},
  prices: Object.fromEntries(
    ["MONTHLY", "SEMIANNUAL", "ANNUAL"].map((interval, index) => [
      interval,
      {
        amountMinor: Number(amount) * [1, 6, 12][index],
        currency: "BRL",
        formatted: "Preço do período",
      },
    ]),
  ),
}));

function overview(status = "TRIALING"): BillingOverview {
  const pending = status === "PENDING_PAYMENT";
  const code = pending ? "PROFESSIONAL" : "ESSENTIAL";
  return {
    catalog: { plans },
    subscription: {
      id: "subscription-fixture",
      planCode: code,
      planLabel: pending ? "Profissional" : "Essencial",
      billingInterval: "MONTHLY",
      status,
      version: 3,
      billingPeriod: period,
      usagePeriod: period,
      trial: pending
        ? null
        : {
            eligible: false,
            trialDays: 30,
            startsAt: period.start,
            endsAt: period.end,
          },
      cancelAtPeriodEnd: false,
      pendingChange: null,
      allowedActions: ["SUBSCRIBE", "CHANGE_PLAN"],
    },
    entitlements: {
      planCode: code,
      label: "Plano atual",
      source: "SUBSCRIPTION",
      capabilities: [],
      window: period,
      allocation: [],
      usage: [],
    },
    billing: {
      configured: true,
      mode: "TEST",
      canCheckout: status !== "ACTIVE",
      canOpenBillingPortal: false,
      allowedActions: ["START_CHECKOUT"],
    },
    invoices: [],
  };
}

async function fixture(
  page: Page,
  options: {
    status?: string;
    signup?: boolean;
    checkoutFails?: boolean;
    changeFails?: boolean;
  } = {},
) {
  let registered = !options.signup;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const data = overview(options.status);
  const profile = {
    id: "billing-user",
    email: "owner@example.test",
    firstName: "Marina",
    lastName: "Silva",
    displayName: "Marina Silva",
    status: "ACTIVE",
    welcomeDismissedAt: new Date().toISOString(),
  };
  const session = () =>
    registered
      ? {
          authenticated: true,
          user: profile,
          scope: {
            organizationId: "billing-org",
            businessUnitId: null,
            businessUnitIds: [],
          },
          roles: [],
          permissions: ["*"],
          isOwner: true,
          surfaceAccess: ["WEB"],
          sessionId: "preview",
          expiresAt: null,
          organization: { id: "billing-org", displayName: "Minha empresa" },
          businessUnits: [],
          organizations: [],
          entitlements: {
            capabilities: ["*"],
            subscriptionStatus: data.subscription?.status,
          },
          productAccess: null,
          isPlatformAdmin: false,
          subscriptionActive: data.subscription?.status !== "PENDING_PAYMENT",
          subscriptionEndsAt: period.end,
          requiresPasswordChange: false,
        }
      : { authenticated: false };
  async function cookie() {
    const claims = {
      sub: profile.id,
      sid: "preview",
      type: "access",
      organizationId: "billing-org",
      roles: [],
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    await page.context().addCookies([
      {
        name: "orbit_access",
        value: `preview.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.preview`,
        url: test.info().project.use.baseURL as string,
      },
    ]);
  }
  if (registered) await cookie();
  await page.route("https://checkout.stripe.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Pagamento Stripe simulado</h1>",
    }),
  );
  await page.route("https://billing.stripe.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Confirmação Stripe simulada</h1>",
    }),
  );
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = {};
    if (route.request().method() === "POST")
      writes.push({
        path,
        body: route.request().postDataJSON() as Record<string, unknown>,
      });
    if (path === "/api/auth/register") {
      registered = true;
      await cookie();
      result = { authenticated: true };
    } else if (path === "/api/auth/session") result = session();
    else if (path === "/api/orbit/billing/overview") result = data;
    else if (
      path.endsWith("/checkout-session") ||
      path.endsWith("/change-plan")
    ) {
      if (
        path.endsWith("/checkout-session")
          ? options.checkoutFails
          : options.changeFails
      ) {
        await route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "BILLING_PROVIDER_UNAVAILABLE",
              message: "Não foi possível abrir o pagamento. Tente novamente.",
            },
          },
        });
        return;
      }
      result = {
        url: path.endsWith("/change-plan")
          ? "https://billing.stripe.test/confirm"
          : "https://checkout.stripe.test/pay",
        expiresAt: null,
      };
    } else if (path.endsWith("/identity/me")) result = profile;
    else if (path.includes("notifications"))
      result = { unread: 0, data: [], meta: { page: 1, total: 0 } };
    await route.fulfill({ json: { success: true, data: result } });
  });
  return { writes, data };
}

async function fillSignup(page: Page, planCode = "PROFESSIONAL") {
  await page.goto(`/cadastro?plano=${planCode}`);
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
  await page.getByRole("button", { name: /Criar/ }).click();
}

test("paid signup opens Stripe after creating the account exactly once", async ({
  page,
}) => {
  const { writes } = await fixture(page, {
    signup: true,
    status: "PENDING_PAYMENT",
  });
  await fillSignup(page);
  await expect(page).toHaveURL("https://checkout.stripe.test/pay");
  expect(writes.map((write) => write.path)).toEqual([
    "/api/auth/register",
    "/api/orbit/billing/checkout-session",
  ]);
  expect(writes[1].body).toMatchObject({
    planCode: "PROFESSIONAL",
    billingInterval: "MONTHLY",
  });
});

test("checkout failure preserves signup and offers payment recovery", async ({
  page,
}) => {
  const { writes } = await fixture(page, {
    signup: true,
    status: "PENDING_PAYMENT",
    checkoutFails: true,
  });
  await fillSignup(page);
  await expect(page).toHaveURL(
    /configuracoes\?secao=assinatura&cadastro=concluido&pagamento=pendente/,
  );
  await expect(
    page.getByText("Seu cadastro está concluído. Falta finalizar o pagamento."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Continuar para o pagamento",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    writes.filter((write) => write.path === "/api/auth/register"),
  ).toHaveLength(1);
  await expect(page.getByText("Sua avaliação gratuita terminou")).toHaveCount(
    0,
  );
});

test("trial plan change warns first; cancel preserves trial and confirmation opens Stripe", async ({
  page,
}) => {
  const { writes, data } = await fixture(page);
  await page.goto("/configuracoes?secao=assinatura");
  const card = page.getByRole("article", { name: "Profissional", exact: true });
  await card.getByRole("button", { name: "Migrar para este" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("dias gratuitos restantes");
  await expect(dialog).toContainText("A cobrança começa agora");
  expect(writes).toEqual([]);
  await dialog.getByRole("button", { name: "Voltar", exact: true }).click();
  expect(data.subscription?.planCode).toBe("ESSENTIAL");
  expect(writes).toEqual([]);
  await card.getByRole("button", { name: "Migrar para este" }).click();
  await dialog
    .getByRole("button", { name: "Continuar para o pagamento" })
    .click();
  await expect(page).toHaveURL("https://billing.stripe.test/confirm");
  expect(writes).toEqual([
    {
      path: "/api/orbit/organizations/current/subscription/change-plan",
      body: {
        expectedVersion: 3,
        planCode: "PROFESSIONAL",
        billingInterval: "MONTHLY",
        acknowledgeTrialEnd: true,
      },
    },
  ]);
  expect(data.subscription?.planCode).toBe("ESSENTIAL");
});

test("API failure remains visible and keeps the confirmation available for retry", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { writes } = await fixture(page, { changeFails: true });
  await page.goto("/configuracoes?secao=assinatura");
  await page
    .getByRole("article", { name: "Profissional", exact: true })
    .getByRole("button", { name: "Migrar para este" })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Continuar para o pagamento" })
    .click();
  await expect(
    page.getByText("Não foi possível concluir a solicitação"),
  ).toBeVisible();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continuar para o pagamento" }),
  ).toBeEnabled();
  expect(writes).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("return waits for the chosen paid plan, then refreshes the session", async ({
  page,
}) => {
  const { data } = await fixture(page, { status: "ACTIVE" });
  await page.addInitScript(() =>
    sessionStorage.setItem(
      "orbit:billing-target",
      JSON.stringify({
        subscriptionId: "subscription-fixture",
        planCode: "PROFESSIONAL",
        billingInterval: "MONTHLY",
      }),
    ),
  );
  await page.goto("/configuracoes?secao=assinatura&assinatura=sucesso");
  await expect(
    page.getByText(/Estamos confirmando sua assinatura/),
  ).toBeVisible();
  data.subscription!.planCode = "PROFESSIONAL";
  data.subscription!.planLabel = "Profissional";
  data.subscription!.version = 4;
  await expect(
    page.getByText(/Estamos confirmando sua assinatura/),
  ).toHaveCount(0, { timeout: 12000 });
  expect(
    await page.evaluate(() => sessionStorage.getItem("orbit:billing-target")),
  ).toBeNull();
});

test("Essential trial signup enters the app without opening a paid checkout", async ({
  page,
}) => {
  const { writes } = await fixture(page, { signup: true, status: "TRIALING" });
  await fillSignup(page, "ESSENTIAL");
  await expect(page).toHaveURL(/dashboard$/);
  expect(writes.map((write) => write.path)).toEqual(["/api/auth/register"]);
});

test("active customer confirms the change in Stripe before the current plan changes", async ({
  page,
}) => {
  const { writes, data } = await fixture(page, { status: "ACTIVE" });
  await page.goto("/configuracoes?secao=assinatura");
  await page
    .getByRole("article", { name: "Profissional", exact: true })
    .getByRole("button", { name: "Migrar para este" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("conferir os valores");
  await expect(dialog).not.toContainText("dias gratuitos restantes");
  await dialog
    .getByRole("button", { name: "Continuar para o pagamento" })
    .click();
  await expect(page).toHaveURL("https://billing.stripe.test/confirm");
  expect(writes[0].body.acknowledgeTrialEnd).toBe(false);
  expect(data.subscription?.planCode).toBe("ESSENTIAL");
});

test("paying for another Essential billing interval also requires explicit trial end confirmation", async ({
  page,
}) => {
  const { writes } = await fixture(page);
  await page.goto("/configuracoes?secao=assinatura");
  await page.getByRole("tab", { name: "Anual", exact: true }).click();
  await page
    .getByRole("article", { name: "Essencial", exact: true })
    .getByRole("button", { name: "Alterar periodicidade" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("dias gratuitos restantes");
  await dialog
    .getByRole("button", { name: "Continuar para o pagamento" })
    .click();
  await expect(page).toHaveURL("https://billing.stripe.test/confirm");
  expect(writes[0].body).toMatchObject({
    planCode: "ESSENTIAL",
    billingInterval: "ANNUAL",
    acknowledgeTrialEnd: true,
  });
});
