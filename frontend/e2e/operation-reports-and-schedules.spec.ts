import { expect, test, type Page } from "@playwright/test";

const stamp = "2026-11-10T12:00:00Z";
const paginate = (data: unknown[], page = 1, total = data.length) => ({
  data,
  meta: {
    page,
    limit: 5,
    total,
    totalPages: Math.ceil(total / 5),
    hasNextPage: page * 5 < total,
    hasPreviousPage: page > 1,
  },
});

async function setup(
  page: Page,
  options: {
    empty?: boolean;
    scheduleError?: boolean;
    readOnly?: boolean;
    status?: string;
    reports?: string[];
  } = {},
) {
  const scheduleQueries: string[] = [];
  const signedQueries: string[] = [];
  const reports = options.reports ?? ["OS", "RVT", "Relatório especial"];
  let scheduleFails = options.scheduleError ?? false;
  let pending = true;
  const unit = {
    id: "unit",
    legalName: "Matriz",
    timezone: "America/Recife",
    isPrimary: true,
  };
  const claims = {
    sub: "owner",
    sid: "test",
    type: "access",
    organizationId: "org",
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
  await page.context().route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown = paginate([]);
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
        isOwner: !options.readOnly,
        permissions: options.readOnly
          ? ["operations.read", "artifact_executions.read"]
          : ["*"],
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
    else if (path === "/api/orbit/customers/client")
      data = {
        id: "client",
        legalName: "Cliente da agenda",
        type: "COMPANY",
        status: "ACTIVE",
        contacts: [],
        counts: { assets: 0, operations: 0 },
        address: null,
        createdAt: stamp,
        updatedAt: stamp,
      };
    else if (path === "/api/orbit/assets/equipment")
      data = {
        id: "equipment",
        name: "Equipamento da agenda",
        category: "HVAC",
        status: "ACTIVE",
        businessUnit: unit,
        businessUnitId: "unit",
        customer: null,
        specifications: {},
        counts: { operations: 0, artifactExecutions: 0 },
        createdAt: stamp,
        updatedAt: stamp,
      };
    else if (path === "/api/orbit/scheduling/events") {
      scheduleQueries.push(url.search);
      if (scheduleFails) {
        await route.fulfill({
          status: 400,
          json: {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Não foi possível consultar a agenda.",
            },
          },
        });
        return;
      }
      data = options.empty
        ? []
        : [
            {
              eventId: "event",
              occurrenceId: "occurrence",
              title: "Visita agendada",
              startsAt: stamp,
              endsAt: "2026-11-10T13:00:00Z",
              type: "VISIT",
              status: "SCHEDULED",
            },
          ];
    } else if (path === "/api/orbit/operations/operation")
      data = {
        id: "operation",
        businessUnitId: "unit",
        code: "OP-001",
        kind: "MAINTENANCE",
        title: "Operação concluída",
        status: options.status ?? "COMPLETED",
        priority: "NORMAL",
        businessUnit: unit,
        customer: null,
        customerAddress: null,
        users: [],
        assets: [],
        auxiliaryTechnicians: [],
        attachments: [],
        checklistExecutions: [],
        transitions: [],
        allowedActions: [],
        description: null,
        data: {},
        createdAt: stamp,
        updatedAt: stamp,
      };
    else if (path.endsWith("/field-record"))
      data = { evidence: [], acknowledgement: null };
    else if (path.endsWith("/checklists")) data = [];
    else if (path.endsWith("/timeline")) data = { events: [] };
    else if (path === "/api/orbit/artifact-executions") {
      const p = Number(url.searchParams.get("page") ?? 1);
      data = paginate(
        reports.slice((p - 1) * 5, p * 5).map((name, i) => ({
          id: `report-${(p - 1) * 5 + i}`,
          title: name,
          code: `DOC-${i}`,
          status: "COMPLETED",
          renderStatus:
            name === "Em processamento"
              ? "PENDING"
              : name === "Sem emissão"
                ? "NOT_RENDERED"
                : name === "Falha"
                  ? "FAILED"
                  : "READY",
          progress: 100,
        })),
        p,
        reports.length,
      );
    } else if (/\/artifact-executions\/report-\d+\/render$/.test(path))
      data = { renderStatus: pending ? "PENDING" : "READY" };
    else if (/\/artifact-executions\/report-\d+\/manifests$/.test(path)) {
      const id = path.split("/").at(-2)!;
      data = {
        data: [
          {
            id: `${id}-old`,
            revision: 1,
            isActive: false,
            status: "SUPERSEDED",
            contentHash: "old",
          },
          {
            id: `${id}-revoked`,
            revision: 3,
            isActive: false,
            status: "REVOKED",
            contentHash: "revoked",
          },
          {
            id: `${id}-active`,
            revision: 2,
            isActive: true,
            status: "ISSUED",
            contentHash: "issued",
            format: "PDF",
          },
        ],
        meta: { total: 3, activeRevision: 2 },
      };
    } else if (/\/artifact-manifests\/.+\/download$/.test(path)) {
      signedQueries.push(path + url.search);
      data = {
        url: `http://localhost:6001/api/v1/storage/objects?bucket=reports&key=${path.split("/").at(-2)}&operation=download&expires=9999999999&signature=test`,
        expiresAt: "2099-12-31T00:00:00Z",
        requiredHeaders: {},
      };
    } else if (path === "/api/orbit/storage/objects") {
      await route.fulfill({
        contentType: "application/pdf",
        headers: {
          "content-disposition": "attachment; filename=relatorio.pdf",
        },
        body: "%PDF-1.7\nrelatorio de teste",
      });
      return;
    } else if (path.endsWith("/health"))
      data = { status: "HEALTHY", score: 100, issues: [] };
    else if (path.includes("/qr")) data = { identity: null };
    await route.fulfill({ json: { success: true, data } });
  });
  return {
    scheduleQueries,
    signedQueries,
    recover: () => {
      scheduleFails = false;
    },
    finish: () => {
      pending = false;
    },
  };
}

for (const [kind, href, panel] of [
  ["cliente", "/clientes/client", "customer-schedule"],
  ["equipamento", "/ativos/equipment", "asset-schedule"],
]) {
  test(`agenda do ${kind} carrega e mantém a mesma consulta após novas renderizações`, async ({
    page,
  }) => {
    const state = await setup(page);
    await page.goto(href);
    const schedule = page.locator(`[data-panel="${panel}"]`);
    await expect(schedule.getByText("Visita agendada")).toBeVisible();
    const queries = [...state.scheduleQueries];
    await page
      .getByRole("button", { name: /Atualizar/ })
      .first()
      .click();
    await expect(schedule.getByText("Visita agendada")).toBeVisible();
    await expect.poll(() => new Set(state.scheduleQueries).size).toBe(1);
    expect(queries.length).toBeLessThanOrEqual(3);
    expect(state.scheduleQueries[0]).toContain(
      kind === "cliente" ? "customerId=client" : "assetId=equipment",
    );
  });
  test(`agenda vazia do ${kind} encerra o carregamento`, async ({ page }) => {
    await setup(page, { empty: true });
    await page.goto(href);
    await expect(
      page.locator(`[data-panel="${panel}"]`).getByText(/Nada agendado/),
    ).toBeVisible();
  });
  test(`erro na agenda do ${kind} permite tentar novamente`, async ({
    page,
  }) => {
    const state = await setup(page, { scheduleError: true });
    await page.goto(href);
    const schedule = page.locator(`[data-panel="${panel}"]`);
    await expect(
      schedule.getByRole("button", { name: /Tentar/ }),
    ).toBeVisible();
    state.recover();
    await schedule.getByRole("button", { name: /Tentar/ }).click();
    await expect(schedule.getByText("Visita agendada")).toBeVisible();
    expect(new Set(state.scheduleQueries).size).toBe(1);
  });
}

test("operação concluída oferece a revisão vigente de OS, RVT e outros relatórios", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/operacoes/operation");
  const panel = page.locator('[data-panel="operation-reports"]');
  for (const title of ["OS", "RVT", "Relatório especial"])
    await expect(
      panel.getByRole("link", {
        name: `Baixar relatório: ${title}`,
        exact: true,
      }),
    ).toHaveAttribute("href", /^\/api\/orbit\/storage\/objects\?/);
  expect(state.signedQueries).toHaveLength(3);
  expect(
    state.signedQueries.every((query) =>
      query.includes("-active/download?operation=download"),
    ),
  ).toBe(true);
  const request = page.context().waitForEvent("request", {
    predicate: (req) =>
      new URL(req.url()).pathname === "/api/orbit/storage/objects",
  });
  await panel
    .getByRole("link", { name: "Baixar relatório: OS", exact: true })
    .click();
  const resource = await request;
  const response = await resource.response();
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-disposition"]).toContain("relatorio.pdf");
});

test("relatórios não emitidos e falhas não permanecem em carregamento", async ({
  page,
}) => {
  await setup(page, { reports: ["Sem emissão", "Falha"] });
  await page.goto("/operacoes/operation");
  const panel = page.locator('[data-panel="operation-reports"]');
  await expect(
    panel.getByText("O relatório ainda não foi gerado."),
  ).toBeVisible();
  await expect(
    panel.getByText(/Não foi possível gerar este relatório/),
  ).toBeVisible();
  await expect(panel.getByText("Preparando relatório…")).toHaveCount(0);
});

test("acompanha emissão pendente até liberar o download", async ({ page }) => {
  const state = await setup(page, { reports: ["Em processamento"] });
  await page.goto("/operacoes/operation");
  const panel = page.locator('[data-panel="operation-reports"]');
  await expect(panel.getByText("Preparando relatório…")).toBeVisible();
  state.finish();
  await expect(
    panel.getByRole("link", { name: "Baixar relatório: Em processamento" }),
  ).toBeVisible();
});

test("lista todos os relatórios com paginação", async ({ page }) => {
  await setup(page, {
    reports: ["OS", "RVT", "Terceiro", "Quarto", "Quinto", "Sexto"],
  });
  await page.goto("/operacoes/operation");
  const panel = page.locator('[data-panel="operation-reports"]');
  await expect(
    panel.getByRole("link", { name: "Baixar relatório: OS", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(
    panel.getByRole("link", { name: "Baixar relatório: Sexto", exact: true }),
  ).toBeVisible();
});

test("conta sem acesso ao documento não solicita URLs de download", async ({
  page,
}) => {
  const state = await setup(page, { readOnly: true });
  await page.goto("/operacoes/operation");
  const panel = page.locator('[data-panel="operation-reports"]');
  await expect(panel.getByText("OS", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("link", { name: /Baixar relatório:/ }),
  ).toHaveCount(0);
  expect(state.signedQueries).toHaveLength(0);
});

test("operação em andamento mantém a seção de documentos sem apresentar conclusão", async ({
  page,
}) => {
  await setup(page, { status: "IN_PROGRESS" });
  await page.goto("/operacoes/operation");
  await expect(
    page.locator('[data-panel="operation-artifact-executions"]'),
  ).toBeVisible();
  await expect(page.locator('[data-panel="operation-reports"]')).toHaveCount(0);
});
