import { expect, test, type Page } from "@playwright/test";

const stamp = "2026-11-10T15:00:00Z";
const period = { from: "2026-11-01T03:00:00Z", to: stamp, granularity: "DAY" };
const definitions = [
  ["operations.open", "Atendimentos em aberto", 12],
  ["operations.overdue", "Atendimentos atrasados", 3],
  ["operations.unassigned", "Sem técnico definido", 2],
  ["operations.unscheduled", "Sem agendamento", 4],
  ["operations.completed", "Concluídos no período", 8],
  ["operations.sla_compliance", "Concluídos no prazo", 75],
  ["pmoc.overdue", "Ciclos PMOC pendentes", 1],
  ["rvt.overdue", "Visitas RVT pendentes", 2],
] as const;
const axes = [
  "operations.sla_compliance",
  "operations.scheduling_coverage",
  "technicians.assignment_coverage",
  "pmoc.compliance",
  "rvt.compliance",
];
const rate = (id: string, sampleSize: number, value = 75) => ({
  id,
  label: id,
  domain: id.startsWith("pmoc")
    ? "PMOC"
    : id.startsWith("rvt")
      ? "RVT"
      : id.startsWith("technicians")
        ? "TECHNICIANS"
        : "OPERATIONS",
  value: sampleSize ? value : 0,
  sampleSize,
  basis: { numerator: sampleSize ? 3 : 0, denominator: sampleSize },
  unit: "%",
  status: "ATTENTION",
  executive: false,
  changePercent: 0,
  comparisonAvailable: false,
  direction: "STABLE",
  source: "operations",
  dataQuality: "DERIVED",
});

async function setup(page: Page, empty = false, financialZone?: string) {
  const claims = {
    sub: "owner",
    sid: "test",
    type: "access",
    organizationId: "org",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  await page.context().addCookies([
    {
      name: "orbit_access",
      value: `preview.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.preview`,
      url: test.info().project.use.baseURL as string,
    },
  ]);
  const unit = {
    id: "unit",
    legalName: "Matriz",
    timezone: "America/Recife",
    isPrimary: true,
  };
  const metrics = definitions.map(([id, label, value]) =>
    id === "operations.sla_compliance"
      ? { ...rate(id, empty ? 0 : 4), label, executive: true }
      : {
          ...rate(id, empty ? 0 : value),
          id,
          label,
          value: empty ? 0 : value,
          unit: undefined,
          basis: undefined,
          executive: true,
          dataQuality: "OBSERVED",
        },
  );
  await page.context().route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown = [];
    if (path === "/api/auth/session")
      data = {
        authenticated: true,
        user: {
          id: "owner",
          firstName: "Ana",
          displayName: "Ana",
          timezone: financialZone,
          welcomeDismissedAt: stamp,
        },
        scope: {
          organizationId: "org",
          businessUnitId: "unit",
          businessUnitIds: ["unit"],
        },
        isOwner: true,
        permissions: ["*"],
        roles: [],
        organization: { id: "org", displayName: "Empresa" },
        organizations: [],
        businessUnits: [unit],
        entitlements: { capabilities: ["*"], limits: {} },
        productAccess: null,
        isPlatformAdmin: false,
        subscriptionActive: true,
        requiresPasswordChange: false,
      };
    else if (path === "/api/orbit/dashboard")
      data = {
        generatedAt: stamp,
        context: { segment: "HVAC" },
        layout: {
          version: 1,
          widgets: [
            ...(financialZone
              ? [
                  {
                    id: "financial-health",
                    title: "Saúde financeira",
                    size: "LARGE",
                    order: 30,
                  },
                ]
              : []),
            {
              id: "operations-comparative-radar",
              title: "Radar comparativo",
              size: "MEDIUM",
              order: 5,
            },
            {
              id: "executive-kpis",
              title: "Indicadores Executivos",
              size: "LARGE",
              order: 6,
            },
            {
              id: "health-score",
              title: "Saúde da operação",
              size: "MEDIUM",
              order: 20,
            },
          ],
        },
      };
    else if (path === "/api/orbit/analytics/panel") {
      const dashboard = {
        generatedAt: stamp,
        metrics: [
          ...metrics,
          { ...rate("operations.scheduling_coverage", 4), executive: false },
          {
            ...rate("operations.backlog_punctuality", empty ? 0 : 12),
            basis: { numerator: empty ? 0 : 9, denominator: empty ? 0 : 12 },
            executive: false,
          },
        ],
        headline: {},
        series: [],
        forecasts: [],
        environmentalImpact: [],
      };
      const health = {
        generatedAt: stamp,
        score: empty ? 0 : 75,
        status: "ATTENTION",
        dimensions: [
          {
            id: "operations",
            label: "Fila no prazo",
            score: empty ? 0 : 75,
            hasData: !empty,
            weight: empty ? 0 : 1,
            domain: "OPERATIONS",
            status: "ATTENTION",
            drivers: empty ? [] : ["9 de 12 no prazo", "3 precisam de atenção"],
          },
          {
            id: "pmoc",
            label: "PMOC em dia",
            score: 0,
            hasData: false,
            weight: 0,
            domain: "PMOC",
            status: "CRITICAL",
            drivers: [],
          },
        ],
      };
      data = { dashboard, health, intelligence: null };
    } else if (path === "/api/orbit/analytics/kpis") {
      data = {
        generatedAt: stamp,
        period,
        indicators: axes.map((id) => rate(id, empty ? 0 : 4)),
        availability: [],
      };
    } else if (path.endsWith("/intelligence-context"))
      data = {
        priorities: [],
        risks: [],
        trends: [],
        forecasts: [],
        environmental: [],
      };
    else if (path.endsWith("/environmental-impact"))
      data = { indicators: [], impacts: [] };
    else if (path === "/api/orbit/financial/analytics/summary") {
      const totals = { confirmed: "0", pending: "0", cancelled: "0", count: 0 };
      data = {
        period: {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
        },
        currency: "BRL",
        income: totals,
        expense: totals,
        overdue: totals,
        netConfirmed: "0",
        netPending: "0",
      };
    } else if (path.endsWith("/agenda"))
      data = { days: [], occurrences: [], warnings: [] };
    await route.fulfill({ json: { success: true, data } });
  });
}

for (const zone of ["Asia/Tokyo", "America/Los_Angeles"]) {
  test(`saúde financeira envia o dia civil da preferência em ${zone}`, async ({
    page,
  }) => {
    await page.clock.setFixedTime(new Date("2026-11-10T12:00:00Z"));
    await setup(page, false, zone);
    const summary = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname ===
        "/api/orbit/financial/analytics/summary",
    );
    const timeline = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname ===
        "/api/orbit/financial/analytics/timeline",
    );
    await page.goto("/dashboard");
    const painel = page.locator('[data-panel="financial-health"]');
    await expect(painel).toContainText("A receber");
    /* "Este mês" é o padrão: o mês inteiro, dia a dia, no fuso da pessoa. */
    const dates = new URL((await summary).url()).searchParams;
    expect(dates.get("from")).toBe("2026-11-01");
    expect(dates.get("to")).toBe("2026-11-30");
    const history = new URL((await timeline).url()).searchParams;
    expect(history.get("from")).toBe("2026-11-01");
    expect(history.get("granularity")).toBe("DAY");

    /* 7 dias terminam hoje. */
    const semana = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname ===
          "/api/orbit/financial/analytics/summary" &&
        new URL(request.url()).searchParams.get("from") === "2026-11-04",
    );
    await painel.getByRole("button", { name: "7 dias", exact: true }).click();
    expect(new URL((await semana).url()).searchParams.get("to")).toBe(
      "2026-11-10",
    );
  });
}

test("mostra oito indicadores acionáveis, bases de cálculo e dimensões reais", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date(stamp));
  const analyticsRequests: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/orbit/analytics/"))
      analyticsRequests.push(pathname.split("/").at(-1)!);
  });
  await setup(page);
  await page.goto("/dashboard");
  const executive = page.locator('[data-panel="executive-kpis"]');
  for (const [, label] of definitions)
    await expect(executive.getByText(label, { exact: true })).toBeVisible();
  await expect(executive.getByText("75%", { exact: true })).toBeVisible();
  await expect(executive.getByText(/3 de 4\./)).toBeVisible();
  await expect(
    executive.getByText("Demandas com agenda", { exact: true }),
  ).toHaveCount(0);
  await expect(
    executive.getByText("Contratos ativos", { exact: true }),
  ).toHaveCount(0);
  const health = page.locator('[data-panel="health-score"]');
  await expect(
    health.getByText("Atendimentos em aberto sem atraso", { exact: true }),
  ).toBeVisible();
  await expect(health.getByText("9 de 12", { exact: true })).toBeVisible();
  await expect(health.getByText("3 atrasados", { exact: true })).toBeVisible();
  await expect(health.getByText(/pontos de atenção/)).toBeVisible();
  /* Sem nota abstrata de 0 a 100. */
  await expect(health.getByText("/ 100")).toHaveCount(0);

  const comparativo = page.locator(
    '[data-panel="operations-comparative-radar"]',
  );
  for (const linha of ["Concluídos no prazo", "PMOC em dia", "Visitas de RVT em dia"])
    await expect(comparativo.getByText(linha, { exact: true })).toBeVisible();
  await expect(comparativo.getByText("igual").first()).toBeVisible();
  /* Cinco eixos medidos nos dois meses: os dois polígonos e o resumo. */
  await expect(comparativo.locator(".recharts-radar-polygon")).toHaveCount(2);
  await expect(
    comparativo.getByText("Estável nos 5 indicadores comparáveis."),
  ).toBeVisible();
  expect(analyticsRequests.filter((path) => path === "panel")).toHaveLength(1);
  expect(analyticsRequests.filter((path) => path === "kpis")).toHaveLength(2);
  expect(analyticsRequests).not.toContain("dashboard");
  expect(analyticsRequests).not.toContain("health");
  expect(analyticsRequests).not.toContain("intelligence");
});

test("organização nova distingue ausência de base de cálculo de desempenho zero", async ({
  page,
}) => {
  await setup(page, true);
  await page.goto("/dashboard");
  const executive = page.locator('[data-panel="executive-kpis"]');
  await expect(
    executive.getByText("Sem base de cálculo", { exact: true }),
  ).toBeVisible();
  await expect(executive.getByText("0%", { exact: true })).toHaveCount(0);
  const health = page.locator('[data-panel="health-score"]');
  await expect(health.getByText(/Ainda não há atendimentos, PMOC ou RVT/)).toBeVisible();
  await expect(health.getByText("0%", { exact: true })).toHaveCount(0);
  await expect(
    page
      .locator('[data-panel="operations-comparative-radar"]')
      .getByText(/Ainda não há atendimentos nem manutenções/),
  ).toBeVisible();
});
