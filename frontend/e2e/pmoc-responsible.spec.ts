import { expect, test, type Page } from "@playwright/test";

const PLAN = "pmoc-responsible";
async function setup(
  page: Page,
  options: { empty?: boolean; current?: boolean; readOnly?: boolean } = {},
) {
  let responsibleId = options.current ? "rt-owner" : "";
  let equipmentReads = 0;
  const writes: Record<string, unknown>[] = [];
  const queries: string[] = [];
  const people = [
    { id: "rt-owner", name: "Ana Responsável", signatureAvailable: true },
    { id: "rt-other", name: "Carlos Responsável", signatureAvailable: false },
  ];
  const plan = () => ({
    id: PLAN,
    code: "PMOC-001",
    name: "Manutenção mensal",
    status: "ACTIVE",
    validity: { startsOn: "2026-01-01", endsOn: "2027-12-31" },
    frequency: { amount: 1, unit: "MONTHS", label: "Mensal" },
    compliance: {
      status: "UP_TO_DATE",
      overdue: false,
      nextDueOn: "2026-12-01",
      dueSoonDays: 15,
    },
    businessUnit: { id: "plan-unit", name: "Unidade do contrato" },
    customer: { id: "customer", name: "Cliente" },
    technicalResponsible: responsibleId
      ? {
          id: responsibleId,
          displayName: people.find((person) => person.id === responsibleId)
            ?.name,
        }
      : null,
    technician: null,
    notes: "",
    coveredEquipment: 1,
    allowedTransitions: [],
    configuration: {},
    units: [],
    coverages: [],
    createdBy: { id: "owner", displayName: "Owner" },
  });
  const claims = {
    sub: "owner",
    sid: "ui-test",
    type: "access",
    organizationId: "org",
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
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let data: unknown = {
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
    };
    if (path === "/api/auth/session")
      data = {
        authenticated: true,
        user: {
          id: "owner",
          firstName: "Owner",
          displayName: "Owner",
          welcomeDismissedAt: "2026-11-01T12:00:00Z",
        },
        scope: {
          organizationId: "org",
          businessUnitId: "active-unit",
          businessUnitIds: ["active-unit", "plan-unit"],
        },
        isOwner: !options.readOnly,
        permissions: options.readOnly ? ["pmoc.read"] : ["*"],
        roles: [],
        organization: { id: "org", displayName: "Empresa" },
        organizations: [],
        businessUnits: [
          {
            id: "active-unit",
            legalName: "Matriz",
            timezone: "America/Recife",
            isPrimary: true,
          },
        ],
        entitlements: { capabilities: ["*"], limits: {} },
        productAccess: null,
        isPlatformAdmin: false,
        subscriptionActive: true,
        requiresPasswordChange: false,
      };
    else if (path === `/api/orbit/pmoc/plans/${PLAN}`) {
      if (request.method() === "PATCH") {
        const input = request.postDataJSON() as Record<string, unknown>;
        writes.push(input);
        responsibleId = input.technicalResponsibleUserId as string;
      }
      data = plan();
    } else if (path.endsWith("/eligible-technical-responsibles")) {
      queries.push(url.searchParams.get("businessUnitId") ?? "");
      data = options.empty ? [] : people;
    } else if (path === `/api/orbit/pmoc/plans/${PLAN}/executions`)
      data = [
        {
          id: "cycle",
          sequenceNumber: 1,
          status: "PENDING",
          dueOn: "2026-12-01",
        },
      ];
    else if (path.endsWith("/equipment-executions")) {
      equipmentReads++;
      data = [
        {
          coverageId: "coverage",
          equipment: {
            id: "asset",
            name: "Split principal",
            identifier: "EQP-01",
            status: "ACTIVE",
          },
          status: "NOT_STARTED",
          execution: null,
          schedule: null,
          management: { version: "unplanned", allowedActions: [] },
          eligibility: {
            ready: Boolean(responsibleId),
            blockedReasons: responsibleId
              ? []
              : ["TECHNICAL_RESPONSIBLE_MISSING"],
          },
        },
      ];
    }
    await route.fulfill({ json: { success: true, data } });
  });
  await page.goto(`/pmoc/${PLAN}`);
  await expect(
    page.getByRole("heading", { name: "Manutenção mensal" }),
  ).toBeVisible();
  return { writes, queries, reads: () => equipmentReads };
}

test("o item bloqueado permite definir RT e atualiza a elegibilidade sem recarregar", async ({
  page,
}) => {
  const state = await setup(page);
  await page.getByRole("tab", { name: "Execuções", exact: true }).click();
  await page
    .getByRole("button", { name: "Definir Responsável Técnico" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Salvar", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("combobox", { name: /Responsável Técnico/ }).click();
  await page
    .getByRole("option", { name: "Ana Responsável", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Definir Responsável Técnico" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Atender", exact: true }),
  ).toBeEnabled();
  expect(state.writes[0]?.technicalResponsibleUserId).toBe("rt-owner");
  expect(state.queries.length).toBeGreaterThan(0);
  expect(new Set(state.queries)).toEqual(new Set(["plan-unit"]));
  expect(state.reads()).toBeGreaterThan(1);
});

test("a edição mostra o RT atual e permite substituí-lo, avisando sobre assinatura pendente", async ({
  page,
}) => {
  const state = await setup(page, { current: true });
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("combobox", { name: /Responsável Técnico/ }),
  ).toContainText("Ana Responsável");
  await dialog.getByRole("combobox", { name: /Responsável Técnico/ }).click();
  await page.getByRole("option", { name: /Carlos Responsável/ }).click();
  await expect(
    dialog.getByText(/Carlos Responsável ainda não tem assinatura/),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(state.writes[0]?.technicalResponsibleUserId).toBe("rt-other");
});

test("sem profissionais habilitados, explica como resolver e impede salvar vazio", async ({
  page,
}) => {
  await setup(page, { empty: true });
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Ninguém está habilitado/)).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Configurar responsável na Equipe" }),
  ).toHaveAttribute("href", "/equipe");
  await expect(
    dialog.getByRole("button", { name: "Salvar", exact: true }),
  ).toBeDisabled();
});

test("a consulta não oferece edição para quem só pode ler o PMOC", async ({
  page,
}) => {
  await setup(page, { readOnly: true });
  await page.getByRole("tab", { name: "Execuções", exact: true }).click();
  await expect(
    page.getByText("O plano não tem Responsável Técnico definido."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Definir Responsável Técnico" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Editar", exact: true }),
  ).toHaveCount(0);
});
