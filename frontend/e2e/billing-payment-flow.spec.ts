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
    malformedChange?: boolean;
    entitlementsUnavailable?: boolean;
    stallOverviewAfterChange?: boolean;
    trialEligible?: boolean;
    overLimit?: boolean;
    cancelFails?: boolean;
  } = {},
) {
  let registered = !options.signup;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const data = overview(options.status);
  if (options.status === "ACTIVE")
    data.subscription!.allowedActions = [
      ...data.subscription!.allowedActions,
      "CANCEL_AT_PERIOD_END",
    ];
  data.billing.canStartEssentialTrial = options.trialEligible;
  if (options.overLimit)
    data.entitlements.limitAdjustment = {
      effectiveAt: period.start,
      deadline: period.end,
      blocked: false,
      resources: [
        {
          resource: "PLATFORM_USERS",
          current: 10,
          limit: { unlimited: false, value: 5 },
          remaining: 0,
        },
      ],
    };
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
          subscription: data.subscription,
          subscriptionStatus: data.subscription?.status,
          subscriptionTrialEndsAt: data.subscription?.trial?.endsAt ?? null,
          entitlements: options.entitlementsUnavailable
            ? null
            : {
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
    const body =
      route.request().method() === "POST"
        ? (route.request().postDataJSON() as Record<string, unknown>)
        : {};
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
    else if (path === "/api/orbit/billing/overview") {
      if (
        options.stallOverviewAfterChange &&
        writes.some((write) => write.path.endsWith("/change-plan"))
      ) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
      result = data;
    } else if (
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
      if (
        path.endsWith("/change-plan") &&
        !options.malformedChange &&
        data.subscription?.status === "ACTIVE"
      ) {
        data.subscription.pendingChange = {
          planCode: String(body.planCode),
          billingInterval: String(body.billingInterval),
          effectiveAt: period.end,
        };
        result = { kind: "SCHEDULED", effectiveAt: period.end };
      } else if (
        path.endsWith("/change-plan") &&
        options.trialEligible &&
        data.subscription &&
        body.planCode === "ESSENTIAL"
      ) {
        data.subscription.status = "TRIALING";
        data.subscription.planCode = "ESSENTIAL";
        data.subscription.trial = {
          eligible: false,
          trialDays: 30,
          startsAt: period.start,
          endsAt: period.end,
        };
        result = { kind: "TRIAL_STARTED", endsAt: period.end };
      } else
        result =
          options.malformedChange && path.endsWith("/change-plan")
            ? { status: "ACTIVE", planCode: "PROFESSIONAL" }
            : {
                url: path.endsWith("/change-plan")
                  ? "https://billing.stripe.test/confirm"
                  : "https://checkout.stripe.test/pay",
                expiresAt: null,
              };
    } else if (path.endsWith("/cancel")) {
      if (options.cancelFails) {
        await route.fulfill({
          status: 503,
          json: {
            success: false,
            error: {
              code: "BILLING_PROVIDER_UNAVAILABLE",
              message: "Não foi possível cancelar. Tente novamente.",
            },
          },
        });
        return;
      }
      data.subscription!.cancelAtPeriodEnd = true;
      data.dataRetentionEndsAt = new Date(
        new Date(period.end).getTime() + 30 * 86400000,
      ).toISOString();
      result = data.subscription;
    } else if (path.endsWith("/organizations/current/entitlements"))
      result = data.entitlements;
    else if (path.endsWith("/identity/me")) result = profile;
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
  await page.getByLabel("UF", { exact: true }).fill("PE");
  await page
    .getByLabel("Endereço da matriz", { exact: true })
    .fill("Rua da Aurora, 100");
  await page.locator("#terms").check();
  await page.getByRole("button", { name: /Criar/ }).click();
}

test("canceling renewal explains automatic deletion and preserves the paid plan", async ({
  page,
}) => {
  const { writes, data } = await fixture(page, { status: "ACTIVE" });
  await page.goto("/configuracoes?secao=assinatura");
  await page
    .getByRole("button", { name: "Cancelar renovação", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("30 dias");
  await expect(dialog).toContainText("excluídos automaticamente");
  expect(writes).toEqual([]);
  await dialog
    .getByRole("button", { name: "Cancelar renovação", exact: true })
    .click();
  await expect(
    page.getByText("Renovação cancelada; seu período continua disponível", {
      exact: true,
    }),
  ).toBeVisible();
  expect(writes[0].body).toMatchObject({
    expectedVersion: 3,
    acknowledgeDataDeletion: true,
  });
  expect(data.subscription?.status).toBe("ACTIVE");
  expect(data.subscription?.planCode).toBe("ESSENTIAL");
});

test("provider cancellation errors remain visible for retry", async ({
  page,
}) => {
  const { writes } = await fixture(page, {
    status: "ACTIVE",
    cancelFails: true,
  });
  await page.goto("/configuracoes?secao=assinatura");
  await page
    .getByRole("button", { name: "Cancelar renovação", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("button", { name: "Cancelar renovação", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect.poll(() => writes.length).toBe(1);
});

test("ended subscriptions offer a new checkout for the same organization", async ({
  page,
}) => {
  const { data, writes } = await fixture(page, { status: "CANCELED" });
  data.subscription!.billingPeriod = {
    start: new Date(Date.now() - 60 * 86400000).toISOString(),
    end: new Date(Date.now() - 86400000).toISOString(),
  };
  data.subscription!.cancelAtPeriodEnd = true;
  data.dataRetentionEndsAt = new Date(Date.now() + 29 * 86400000).toISOString();
  await page.goto("/configuracoes?secao=assinatura");
  await expect(
    page.getByText("Escolha um plano para continuar com seus dados", {
      exact: true,
    }),
  ).toBeVisible();
  const expired = page.getByRole("dialog");
  if (await expired.isVisible())
    await expired.getByRole("button", { name: "Agora não" }).click();
  await page
    .getByRole("article", { name: "Essencial", exact: true })
    .getByRole("button", { name: /Assinar/ })
    .click();
  await expect(page).toHaveURL("https://checkout.stripe.test/pay");
  expect(writes[0].path).toContain("checkout-session");
});

test("settings makes both legal documents readable after login", async ({
  page,
}) => {
  await fixture(page, { status: "ACTIVE" });
  await page.goto("/configuracoes?secao=termos");
  await page
    .getByRole("button", { name: "Ler Política de Privacidade", exact: true })
    .click();
  await expect(
    page
      .frameLocator('iframe[title="Política de Privacidade"]')
      .getByRole("heading", {
        name: "Política de Privacidade do Orbit",
        exact: true,
      }),
  ).toBeVisible();
});

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
  await expect(page.getByRole("alertdialog").getByRole("alert")).toBeVisible();
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

test("active customer schedules the change at renewal and keeps the paid plan", async ({
  page,
}) => {
  const { writes, data } = await fixture(page, { status: "ACTIVE" });
  await page.goto("/configuracoes?secao=assinatura");
  await page
    .getByRole("article", { name: "Profissional", exact: true })
    .getByRole("button", { name: "Migrar para este" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(
    "novo valor será cobrado somente na renovação",
  );
  await expect(dialog).not.toContainText("dias gratuitos restantes");
  await dialog
    .getByRole("button", { name: "Agendar mudança na renovação" })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Troca agendada para" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/configuracoes/);
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

test("pending first payment redirects dashboard access to billing and never displays a future expiry", async ({
  page,
}) => {
  await fixture(page, {
    status: "PENDING_PAYMENT",
    entitlementsUnavailable: true,
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/configuracoes\?secao=assinatura/);
  await expect(
    page.getByRole("button", {
      name: "Continuar para o pagamento",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Sua avaliação gratuita terminou")).toHaveCount(
    0,
  );
  await expect(page.getByText(/O período de acesso foi até/)).toHaveCount(0);
  await expect(page.getByText("Próxima renovação")).toHaveCount(0);
  await page.goto("/clientes");
  await expect(page).toHaveURL(/configuracoes\?secao=assinatura/);
  await expect(
    page.getByRole("button", {
      name: "Continuar para o pagamento",
      exact: true,
    }),
  ).toBeVisible();
});

test("a legacy 200 without payment URL stays in the modal with an explicit error", async ({
  page,
}) => {
  await fixture(page, { malformedChange: true });
  await page.goto("/configuracoes?secao=assinatura");
  await page
    .getByRole("article", { name: "Profissional", exact: true })
    .getByRole("button", { name: "Migrar para este" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog
    .getByRole("button", { name: "Continuar para o pagamento" })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "O pagamento não retornou um endereço válido",
  );
  await expect(page).toHaveURL(/configuracoes\?secao=assinatura/);
  await expect(
    dialog.getByRole("button", { name: "Continuar para o pagamento" }),
  ).toBeEnabled();
});

test("successful payment redirect does not wait for a billing overview refresh", async ({
  page,
}) => {
  await fixture(page, { stallOverviewAfterChange: true });
  await page.goto("/configuracoes?secao=assinatura");
  await page
    .getByRole("article", { name: "Profissional", exact: true })
    .getByRole("button", { name: "Migrar para este" })
    .click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Continuar para o pagamento" })
    .click();
  await expect(page).toHaveURL("https://billing.stripe.test/confirm", {
    timeout: 5000,
  });
});

test("pending Professional can start the unused Essential trial without Stripe navigation", async ({
  page,
}) => {
  const { writes, data } = await fixture(page, {
    status: "PENDING_PAYMENT",
    trialEligible: true,
  });
  await page.goto("/configuracoes?secao=assinatura");
  await page
    .getByRole("article", { name: "Essencial", exact: true })
    .getByRole("button", { name: "Mudar para este" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("30 dias gratuitos");
  await dialog.getByRole("button", { name: "Começar 30 dias grátis" }).click();
  await expect(
    page.getByText("Seu teste gratuito no Essencial começou", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Período de teste", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/configuracoes/);
  expect(writes.some((w) => w.path.endsWith("/checkout-session"))).toBe(false);
  expect(data.subscription?.status).toBe("TRIALING");
});

test("Essential without trial eligibility requires payment and never offers free days", async ({
  page,
}) => {
  await fixture(page, { status: "PENDING_PAYMENT", trialEligible: false });
  await page.goto("/configuracoes?secao=assinatura");
  await page
    .getByRole("article", { name: "Essencial", exact: true })
    .getByRole("button", { name: "Mudar para este" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByRole("button", { name: "Começar 30 dias grátis" }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Continuar para o pagamento" })
    .click();
  await expect(page).toHaveURL("https://billing.stripe.test/confirm");
});

test("the downgrade adjustment notice appears in the shell and preserves data", async ({
  page,
}) => {
  await fixture(page, { status: "ACTIVE", overLimit: true });
  await page.goto("/configuracoes?secao=assinatura");
  const notice = page
    .getByRole("alert")
    .filter({ hasText: "ajuste os recursos excedentes" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("48 horas");
  await expect(notice).toContainText("10 em uso / 5 permitidos");
  await expect(notice).toContainText("não exclui seus dados automaticamente");
});
