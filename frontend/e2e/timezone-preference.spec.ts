import { expect, test, type Page } from "@playwright/test";
import { assertClean, record } from "./support";

test.use({ timezoneId: "UTC" });

async function fixture(
  page: Page,
  options: {
    timezone?: string | null;
    rejectSave?: boolean;
    recurring?: boolean;
  } = {},
) {
  const profile = {
    id: "timezone-user",
    email: "owner@example.test",
    firstName: "Marina",
    lastName: "Silva",
    displayName: "Marina Silva",
    phone: null,
    timezone:
      options.timezone === undefined ? "America/Rio_Branco" : options.timezone,
    locale: "pt-BR",
    status: "ACTIVE",
    mfaEnabled: false,
    welcomeDismissedAt: "2026-10-01T12:00:00Z",
    createdAt: "2026-10-24T03:30:00Z",
    updatedAt: "2026-10-23T12:00:00Z",
  };
  const unit = {
    id: "timezone-unit",
    organizationId: "timezone-org",
    legalName: "Matriz",
    tradeName: "Matriz",
    timezone: "America/Recife",
    isPrimary: true,
    isActive: true,
  };
  const calendars = [
    {
      id: "timezone-calendar",
      key: "visitas",
      name: "Visitas",
      timezone: "America/Recife",
      businessUnitId: unit.id,
      isDefault: true,
      isActive: true,
      color: null,
    },
  ];
  const event = {
    id: "timezone-event",
    eventId: "timezone-event",
    occurrenceId: "occurrence-1",
    calendarId: calendars[0].id,
    calendar: calendars[0],
    title: "Visita na virada do dia",
    description: null,
    type: "VISITA_TECNICA",
    status: "CONFIRMED",
    priority: "NORMAL",
    startsAt: "2026-10-24T03:30:00Z",
    endsAt: "2026-10-24T04:30:00Z",
    timezone: "America/Recife",
    allDay: false,
    recurring: Boolean(options.recurring),
    recurrence: options.recurring
      ? {
          frequency: "WEEKLY",
          interval: 1,
          byWeekday: [6],
          byMonthDay: null,
          count: null,
          until: null,
          exceptions: ["2026-11-01"],
          timezone: "America/Recife",
        }
      : null,
    source: { module: null, entityId: null, entityType: null },
    allocations: [],
    sourceModule: null,
    sourceEntityId: null,
    sourceEntityType: null,
    customer: null,
    asset: null,
    segment: null,
    location: null,
    businessUnitId: unit.id,
  };
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const reads: { path: string; timezone: string | undefined }[] = [];
  const claims = {
    sub: profile.id,
    sid: "preview",
    type: "access",
    organizationId: "timezone-org",
    businessUnitId: unit.id,
    businessUnitIds: [unit.id],
    roles: [],
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  await page
    .context()
    .addCookies([
      {
        name: "orbit_access",
        value: `preview.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.preview`,
        url: test.info().project.use.baseURL as string,
      },
    ]);
  await page.clock.setFixedTime(new Date("2026-10-23T06:00:00Z"));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let result: unknown = {};
    if (req.method() === "GET")
      reads.push({ path, timezone: req.headers()["x-timezone"] });
    if (["POST", "PATCH"].includes(req.method())) {
      const body = req.postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      if (path.endsWith("/identity/me")) {
        if (options.rejectSave) {
          await route.fulfill({
            status: 400,
            json: {
              success: false,
              error: {
                code: "VALIDATION_ERROR",
                message: "Não foi possível salvar suas preferências.",
              },
            },
          });
          return;
        }
        Object.assign(profile, body, { updatedAt: "2026-10-24T06:00:00Z" });
      }
      if (path.endsWith("/scheduling/calendars"))
        calendars.push({
          ...calendars[0],
          ...body,
          id: "calendar-new",
        } as (typeof calendars)[number]);
    }
    if (path === "/api/auth/session")
      result = {
        authenticated: true,
        user: profile,
        scope: {
          organizationId: "timezone-org",
          businessUnitId: unit.id,
          businessUnitIds: [unit.id],
        },
        roles: [],
        permissions: ["*"],
        isOwner: true,
        surfaceAccess: ["WEB"],
        sessionId: "preview",
        expiresAt: null,
        organization: { id: "timezone-org", displayName: "Empresa" },
        businessUnits: [unit],
        organizations: [],
        entitlements: {
          planKey: "ESSENTIAL",
          capabilities: ["*"],
          subscriptionStatus: "ACTIVE",
        },
        productAccess: null,
        isPlatformAdmin: false,
        subscriptionActive: true,
        subscriptionEndsAt: null,
        requiresPasswordChange: false,
      };
    else if (path.endsWith("/organizations/current"))
      result = {
        id: "timezone-org",
        displayName: "Empresa",
        slug: "empresa",
        settings: {},
        businessUnits: [unit],
        primarySegment: "SERVICES",
      };
    else if (path.endsWith("/business-units")) result = [unit];
    else if (path === "/api/orbit/plans") result = [];
    else if (path.endsWith("/identity/me")) result = profile;
    else if (path.endsWith("/scheduling/calendars"))
      result = req.method() === "POST" ? calendars.at(-1) : calendars;
    else if (path.endsWith("/scheduling/events"))
      result = req.method() === "POST" ? event : [event];
    else if (path.endsWith("/scheduling/events/timezone-event")) result = event;
    else if (
      path.endsWith("/scheduling/conflicts") ||
      path.endsWith("/scheduling/availability")
    )
      result = [];
    else if (path.endsWith("/timeline")) result = { history: [] };
    else if (path.includes("notifications"))
      result = { unread: 0, data: [], meta: { page: 1, total: 0 } };
    await route.fulfill({ json: { success: true, data: result } });
  });
  return { profile, reads, writes };
}

test("novo evento identifica obrigatórios em português e mantém os opcionais livres", async ({ page }) => {
  await fixture(page);
  await page.goto("/agenda");
  await page.getByRole("button", { name: "Novo evento", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Novo evento na agenda" });
  for (const id of ["event-title", "event-calendar", "event-type", "event-start", "event-end"]) {
    await expect(dialog.locator(`label[for="${id}"]`)).toContainText("(obrigatório)");
    await expect(dialog.locator(`#${id}`)).toHaveAttribute("aria-required", "true");
  }
  await expect(dialog.locator('label[for="event-description"]')).not.toContainText("obrigatório");
  await expect(dialog.getByRole("button", { name: "Criar evento", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("status")).toContainText("Preencha os campos obrigatórios");
  await dialog.locator("#event-title").fill("Manutenção agendada");
  await expect(dialog.getByRole("button", { name: "Criar evento", exact: true })).toBeEnabled();
  await dialog.getByRole("checkbox", { name: "Evento recorrente", exact: true }).check();
  await expect(dialog.locator('label[for="event-frequency"]')).toContainText("(obrigatório)");
  await expect(dialog.locator('label[for="event-count"]')).not.toContainText("obrigatório");
});

test("saving the preference propagates to settings, new calendars and HTTP context", async ({
  page,
}) => {
  const recorder = record(page);
  const { writes, reads } = await fixture(page, { timezone: "America/Recife" });
  await page.goto("/perfil?secao=preferencias");
  await page.locator("#preferences-timezone").click();
  await page
    .getByRole("option", { name: "America/Rio_Branco", exact: true })
    .click();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/identity/me") && r.request().method() === "PATCH",
  );
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await page
    .getByRole("link", { name: "Configurações", exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "Agenda", exact: true }).click();
  await expect(
    page.getByText("Exibição: America/Rio_Branco", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Fuso de criação: America/Recife", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Novo calendário", exact: true })
    .click();
  await expect(page.getByText(/fuso: America\/Rio_Branco/)).toBeVisible();
  await page.locator("#calendar-name").fill("Agenda em campo");
  await page
    .getByRole("button", { name: "Criar calendário", exact: true })
    .click();
  await expect
    .poll(
      () =>
        writes.find((w) => w.path.endsWith("/scheduling/calendars"))?.body
          .timezone,
    )
    .toBe("America/Rio_Branco");
  expect(
    reads
      .filter((r) => r.path.endsWith("/scheduling/calendars"))
      .every((r) => r.timezone === "America/Rio_Branco"),
  ).toBeTruthy();
  await page.reload();
  await expect(
    page.getByText("Exibição: America/Rio_Branco", { exact: true }),
  ).toHaveCount(2);
  assertClean(recorder, "preferência de fuso salva");
});

test("agenda and event details convert existing instants to the personal timezone", async ({
  page,
}) => {
  const recorder = record(page);
  await fixture(page);
  await page.goto("/agenda");
  await expect(
    page.locator(
      '[title="Fuso America/Rio_Branco (preferência da sua conta)"]',
    ),
  ).toBeVisible();
  await page
    .getByRole("group", { name: "Visão da agenda" })
    .getByRole("button", { name: "Lista", exact: true })
    .click();
  const row = page
    .getByRole("button", { name: /Visita na virada do dia/ })
    .first();
  await expect(row).toContainText("22:30");
  await row.click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("23/10");
  await expect(detail).toContainText("22:30");
  await expect(detail).toContainText("Horários no fuso: America/Rio_Branco");
  await expect(detail).toContainText("Fuso de criação: America/Recife");
  assertClean(recorder, "agenda no fuso pessoal");
});

test("unit timezone is the fallback only when the account has no preference", async ({
  page,
}) => {
  const recorder = record(page);
  const { reads } = await fixture(page, { timezone: null });
  await page.goto("/configuracoes?secao=agenda");
  await expect(
    page.getByText("Exibição: America/Recife", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Novo calendário", exact: true })
    .click();
  await expect(page.getByText(/fuso: America\/Recife/)).toBeVisible();
  expect(
    reads.find((r) => r.path.endsWith("/scheduling/calendars"))?.timezone,
  ).toBe("America/Recife");
  assertClean(recorder, "fuso da unidade como padrão");
});

test("a refused preference update keeps the previous timezone", async ({
  page,
}) => {
  const recorder = record(page);
  await fixture(page, { timezone: "America/Recife", rejectSave: true });
  await page.goto("/perfil?secao=preferencias");
  await page.locator("#preferences-timezone").click();
  await page
    .getByRole("option", { name: "America/Manaus", exact: true })
    .click();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    page.getByText("Não foi possível salvar suas preferências.").first(),
  ).toBeVisible();
  await page.goto("/configuracoes?secao=agenda");
  await expect(
    page.getByText("Exibição: America/Recife", { exact: true }),
  ).toBeVisible();
  expect(recorder.pageErrors).toEqual([]);
  expect(recorder.reactWarnings).toEqual([]);
});

test("shared date labels outside the agenda use the saved timezone", async ({
  page,
}) => {
  const recorder = record(page);
  await fixture(page);
  await page.goto("/perfil");
  const created = page
    .getByText("Conta criada em", { exact: true })
    .locator("..");
  await expect(created).toContainText("23/10");
  await expect(created).toContainText("22:30");
  assertClean(recorder, "formatação compartilhada");
});

test("new events interpret wall time in the account timezone", async ({
  page,
}) => {
  const recorder = record(page);
  const { writes } = await fixture(page);
  await page.goto("/agenda");
  await page.getByRole("button", { name: "Novo evento", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Horários no fuso America/Rio_Branco");
  await page.locator("#event-title").fill("Visita no fuso preferido");
  await page.locator("#event-start").fill("2026-10-24T09:00");
  await page.locator("#event-end").fill("2026-10-24T10:00");
  await dialog
    .getByRole("button", { name: "Criar evento", exact: true })
    .click();
  await expect
    .poll(() => writes.find((w) => w.path.endsWith("/scheduling/events"))?.body)
    .toMatchObject({
      timezone: "America/Rio_Branco",
      startsAt: "2026-10-24T14:00:00.000Z",
      endsAt: "2026-10-24T15:00:00.000Z",
    });
  assertClean(recorder, "novo agendamento");
});

test("editing a recurring event keeps its original schedule timezone", async ({
  page,
}) => {
  const recorder = record(page);
  const { writes } = await fixture(page, { recurring: true });
  await page.goto("/agenda");
  await page
    .getByRole("group", { name: "Visão da agenda" })
    .getByRole("button", { name: "Lista", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Visita na virada do dia/ })
    .first()
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Editar", exact: true })
    .click();
  const form = page
    .getByRole("dialog")
    .filter({ has: page.locator("#event-title") });
  await expect(page.locator("#event-start")).toHaveValue("2026-10-23T22:30");
  await page.locator("#event-title").fill("Visita com título ajustado");
  await form
    .getByRole("button", { name: "Salvar alterações", exact: true })
    .click();
  await expect
    .poll(
      () => writes.find((w) => w.path.endsWith("/events/timezone-event"))?.body,
    )
    .toMatchObject({
      timezone: "America/Recife",
      startsAt: "2026-10-24T03:30:00.000Z",
      endsAt: "2026-10-24T04:30:00.000Z",
    });
  expect(
    writes.find((w) => w.path.endsWith("/events/timezone-event"))?.body,
  ).not.toHaveProperty("recurrence");
  assertClean(recorder, "recorrência preservada");
});
