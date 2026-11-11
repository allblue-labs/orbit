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

async function setup(page: Page, empty = false) {
  const claims = {
    sub: "owner",
    sid: "test",
    type: "access",
    organizationId: "org",
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
              title: "Índice de Saúde",
              size: "MEDIUM",
              order: 20,
            },
          ],
        },
      };
    else if (path === "/api/orbit/analytics/dashboard")
      data = {
        generatedAt: stamp,
        metrics: [
          ...metrics,
          { ...rate("operations.scheduling_coverage", 4), executive: false },
        ],
        headline: {},
        series: [],
        forecasts: [],
        environmentalImpact: [],
      };
    else if (path === "/api/orbit/analytics/health")
      data = {
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
    else if (path === "/api/orbit/analytics/kpis") {
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
    else if (path.endsWith("/agenda"))
      data = { days: [], occurrences: [], warnings: [] };
    await route.fulfill({ json: { success: true, data } });
  });
}

test("mostra oito indicadores acionáveis, bases de cálculo e dimensões reais", async ({
  page,
}) => {
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
  await expect(health.getByText(/9 de 12 no prazo/)).toBeVisible();
  const radar = page
    .locator(".glass-panel")
    .filter({ has: page.getByText("Radar comparativo", { exact: true }) });
  for (const axis of ["Prazo", "Agenda", "Equipe", "PMOC", "RVT"])
    await expect(
      radar
        .locator(".recharts-polar-angle-axis")
        .getByText(axis, { exact: true }),
    ).toBeVisible();
  await expect(radar.locator(".recharts-radar-polygon")).toHaveCount(2);
  await page.screenshot({
    path: "/private/tmp/orbit-dashboard-review.png",
    fullPage: true,
  });
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
  await expect(health.getByText(/Não há atendimentos em aberto/)).toBeVisible();
  await expect(health.getByText("Crítico", { exact: true })).toHaveCount(0);
  await expect(
    page
      .locator(".glass-panel")
      .filter({ has: page.getByText("Radar comparativo", { exact: true }) })
      .getByText(/Ainda não há três indicadores/),
  ).toBeVisible();
});
