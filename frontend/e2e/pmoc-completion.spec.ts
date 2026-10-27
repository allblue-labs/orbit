import { expect, test, type Page } from "@playwright/test";

const PLAN = "plan-completion";
const CYCLE = "cycle-current";
const ASSET = "asset-current";
const STAMP = "2026-10-27T12:00:00Z";

async function setup(page: Page, failArtifact = false) {
  const writes: string[] = [];
  const preparations: string[] = [];
  let started = false;
  let completed = false;
  let issued = false;
  let fail = failArtifact;
  const cycle = () => ({
    id: CYCLE,
    sequenceNumber: 1,
    dueOn: "2026-10-27",
    status: completed ? "COMPLETED" : "PENDING",
    performedAt: completed ? STAMP : null,
  });
  const equipment = {
    id: ASSET,
    name: "Split sala principal",
    identifier: "SPLIT-01",
    category: "EQUIPMENT",
    status: "ACTIVE",
  };
  const execution = () =>
    started
      ? {
          id: "physical-execution",
          sequenceNumber: 1,
          status: completed ? "COMPLETED" : "IN_PROGRESS",
          responsibleFieldTechnician: {
            id: "technician",
            displayName: "Marina",
          },
          auxiliaryTechnicians: [],
          evidence: [],
          performedAt: completed ? STAMP : null,
          artifactExecution: issued
            ? {
                id: "equipment-report",
                code: "PMOC-EXEC-1",
                status: "COMPLETED",
              }
            : null,
        }
      : null;
  const plan = () => ({
    id: PLAN,
    code: "PMOC-001",
    name: "Contrato preventivo",
    status: "ACTIVE",
    validity: { startsOn: "2026-10-01", endsOn: "2027-10-01" },
    frequency: { amount: 1, unit: "MONTH", label: "Mensal" },
    compliance: {
      status: "UP_TO_DATE",
      overdue: false,
      nextDueOn: "2026-11-27",
    },
    businessUnit: { id: "unit", name: "Matriz" },
    customer: { id: "customer", name: "Cliente do contrato" },
    technician: null,
    technicalResponsible: null,
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
  await page.context().addCookies([
    {
      name: "orbit_access",
      value: `preview.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.preview`,
      url: test.info().project.use.baseURL as string,
    },
  ]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "canShare", {
      configurable: true,
      value: () => true,
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as unknown as { sharedReport: string }).sharedReport =
          data.files?.[0]?.name ?? "";
      },
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === "POST") writes.push(path);
    let data: unknown = {
      data: [],
      meta: { total: 0, page: 1, limit: 10, totalPages: 0 },
    };
    if (path === "/api/auth/session")
      data = {
        authenticated: true,
        user: {
          id: "owner",
          firstName: "Marina",
          displayName: "Marina",
          welcomeDismissedAt: STAMP,
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
        businessUnits: [
          {
            id: "unit",
            legalName: "Matriz",
            timezone: "America/Recife",
            isPrimary: true,
          },
        ],
        organizations: [],
        entitlements: { capabilities: ["*"], limits: {} },
        productAccess: null,
        isPlatformAdmin: false,
        subscriptionActive: true,
        requiresPasswordChange: false,
      };
    else if (path === `/api/orbit/pmoc/plans/${PLAN}`) data = plan();
    else if (path === `/api/orbit/pmoc/plans/${PLAN}/executions`)
      data = completed
        ? [
            {
              id: "cycle-next-month",
              sequenceNumber: 2,
              dueOn: "2026-11-27",
              status: "PENDING",
            },
            cycle(),
          ]
        : [cycle()];
    else if (
      path.endsWith("/equipment-executions/physical-execution/complete")
    ) {
      completed = true;
      data = { execution: execution(), cycleCompleted: true };
    } else if (path.endsWith("/artifact/generate")) {
      if (fail) {
        fail = false;
        await route.fulfill({
          status: 409,
          json: {
            success: false,
            error: {
              code: "CONFLICT",
              message: "Não foi possível emitir o relatório. Tente novamente.",
            },
          },
        });
        return;
      }
      issued = true;
      data = { artifactExecutionId: "equipment-report", created: true };
    } else if (
      path.endsWith(`/equipment/${ASSET}/executions`) &&
      method === "POST"
    ) {
      started = true;
      data = { execution: execution(), created: true };
    } else if (path.endsWith("/execution-preparation")) {
      preparations.push(path);
      data = {
        plan: plan(),
        cycle: cycle(),
        customer: { name: "Cliente do contrato" },
        equipment,
        fieldTechnicians: [{ id: "technician", name: "Marina" }],
        auxiliaryTechnicians: [],
        evidencePolicy: {
          minimumPhotos: 0,
          maximumPhotos: 6,
          acceptedKinds: ["PHOTO"],
        },
        documentPolicy: { artifactType: "PMOC" },
        procedureGroups: [{ group: "Evaporadora", items: ["Limpar filtro"] }],
        eligibility: { ready: true, blockedReasons: [] },
        existingExecution: execution(),
        allowedActions: completed
          ? ["VIEW"]
          : started
            ? ["COMPLETE", "ADD_EVIDENCE"]
            : ["START"],
      };
    } else if (path.endsWith("/equipment-executions"))
      data = [
        {
          coverageId: "coverage",
          equipment,
          status: completed
            ? "COMPLETED"
            : started
              ? "IN_PROGRESS"
              : "NOT_STARTED",
          execution: execution(),
          eligibility: { ready: !completed, blockedReasons: [] },
        },
      ];
    else if (path === "/api/orbit/artifact-executions/equipment-report/render")
      data = { renderStatus: "READY" };
    else if (
      path === "/api/orbit/artifact-executions/equipment-report/manifests"
    )
      data = {
        data: [
          {
            id: "equipment-manifest",
            executionId: "equipment-report",
            isActive: true,
            status: "ISSUED",
            format: "PDF",
            contentHash: "test-hash",
          },
        ],
        meta: { total: 1 },
      };
    else if (
      path === "/api/orbit/artifact-manifests/equipment-manifest/download"
    )
      data = {
        url: "/api/orbit/storage/objects?report=equipment-report",
        expiresAt: "2099-01-01T00:00:00Z",
      };
    else if (path === `/api/orbit/pmoc/plans/${PLAN}/signature-link`)
      data = {
        token: "A".repeat(64),
        planCode: "PMOC-001",
        expiresAt: "2099-01-01T00:00:00Z",
      };
    else if (
      path === `/api/orbit/pmoc/plans/${PLAN}/document` ||
      path === "/api/orbit/storage/objects"
    ) {
      await route.fulfill({
        contentType: "application/pdf",
        headers: { "content-disposition": "attachment; filename=pmoc.pdf" },
        body: "%PDF-1.4 test-report",
      });
      return;
    } else if (path === "/api/orbit/rvt/configurations/visit-configuration")
      data = {
        id: "visit-configuration",
        name: "Visita programada",
        code: "RVT-001",
        status: "ACTIVE",
        scheduleMode: "ONE_TIME",
        coverage: { start: "2026-10-01", end: null },
        customer: { name: "Cliente" },
        businessUnit: { name: "Matriz" },
        equipment: [],
        timezone: "America/Recife",
        startTime: "09:00",
        requiresTechnicalResponsible: false,
      };
    await route.fulfill({ json: { success: true, data } });
  });
  return { writes, preparations };
}

async function attend(page: Page) {
  await page.goto(`/pmoc/${PLAN}`);
  await page.getByRole("tab", { name: "Execuções", exact: true }).click();
  await page.getByRole("button", { name: "Atender", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Abrir atendimento", exact: true })
    .click();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await dialog
    .getByLabel("Observações", { exact: true })
    .fill("Filtro limpo e funcionamento conferido.");
  await dialog
    .getByRole("button", { name: "Revisar atendimento", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirmar e gerar relatório", exact: true })
    .click();
}

test("concluir fecha o wizard, mantém a execução atual e oferece seu relatório", async ({
  page,
}) => {
  const { writes, preparations } = await setup(page);
  await attend(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Atendimento de PMOC finalizado", { exact: true }),
  ).toBeVisible();
  const current = page.getByRole("button", { name: /Execução 1/ });
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("button", { name: /Execução 2/ }),
  ).not.toHaveAttribute("aria-current", "true");
  expect(preparations.some((path) => path.includes("cycle-next-month"))).toBe(
    false,
  );
  const report = page.getByRole("link", {
    name: "Baixar relatório de execução",
    exact: true,
  });
  await expect(report).toHaveAttribute(
    "href",
    "/api/orbit/storage/objects?report=equipment-report",
  );
  await page
    .getByRole("button", { name: "Compartilhar relatório", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { sharedReport?: string }).sharedReport,
      ),
    )
    .toBe("relatorio-execucao-pmoc.pdf");
  expect(writes.filter((path) => path.endsWith("/complete"))).toHaveLength(1);
  expect(
    writes.filter((path) => path.endsWith("/artifact/generate")),
  ).toHaveLength(1);
});

test("falha na emissão mantém o modal e repetir não conclui duas vezes", async ({
  page,
}) => {
  const { writes } = await setup(page, true);
  await attend(page);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Não foi possível emitir o relatório. Tente novamente."),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Emitir relatório", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(writes.filter((path) => path.endsWith("/complete"))).toHaveLength(1);
  expect(
    writes.filter((path) => path.endsWith("/artifact/generate")),
  ).toHaveLength(2);
});

test("o cabeçalho integra a assinatura e baixa o contrato por sua rota própria", async ({
  page,
}) => {
  const { writes } = await setup(page);
  await page.goto(`/pmoc/${PLAN}`);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar contrato", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("pmoc.pdf");
  await page
    .getByRole("button", {
      name: "Enviar contrato para assinatura",
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Link de assinatura do contrato",
  });
  await expect(dialog.getByTestId("pmoc-signature-link")).toContainText(
    `/contrato/${"A".repeat(64)}`,
  );
  expect(writes).toEqual([`/api/orbit/pmoc/plans/${PLAN}/signature-link`]);
  await dialog
    .getByRole("button", { name: "Fechar", exact: true })
    .first()
    .click();
  await expect(page.getByTestId("pmoc-signature-link")).toHaveCount(0);
});

test("a visita técnica oferece volta direta à aba RVT de Operações", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/rvt/visit-configuration");
  await page
    .getByRole("link", { name: "Voltar para RVT", exact: true })
    .click();
  await expect(page).toHaveURL(/\/operacoes\?secao=rvt$/);
  await expect(
    page.getByRole("tab", { name: "RVT", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});
