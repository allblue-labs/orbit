import { expect, test, type Page } from "@playwright/test";

const PLAN = "plan-completion";
const CYCLE = "cycle-current";
const ASSET = "asset-current";
const STAMP = "2026-10-27T12:00:00Z";

async function setup(page: Page, failArtifact = false, canManage = true) {
  const writes: string[] = [];
  const preparations: string[] = [];
  let started = false;
  let completed = false;
  let issued = false;
  let cancelled = false;
  let schedule: {
    version: string;
    responsibleFieldTechnician: { id: string; displayName: string } | null;
    auxiliaryTechnicianIds: string[];
    scheduledFor: string | null;
    notes: string | null;
    cancelledAt: string | null;
    cancellationReason: string | null;
  } | null = null;
  const changes: { path: string; body: Record<string, unknown> }[] = [];
  let fail = failArtifact;
  const cycle = () => ({
    id: CYCLE,
    sequenceNumber: 1,
    dueOn: "2026-10-27",
    status: cancelled ? "CANCELLED" : completed ? "COMPLETED" : "PENDING",
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
    if (method === "POST" || method === "PATCH") writes.push(path);
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
        isOwner: canManage,
        permissions: canManage ? ["*"] : ["pmoc.read"],
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
    else if (path === "/api/orbit/operations/schedule-check") data = [];
    else if (path.endsWith("/schedule") && method === "PATCH") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      changes.push({ path, body });
      const id = body.responsibleFieldTechnicianId as string;
      schedule = {
        version: STAMP,
        responsibleFieldTechnician: id
          ? { id, displayName: id === "technician" ? "Marina" : "Carlos" }
          : null,
        auxiliaryTechnicianIds: body.auxiliaryTechnicianIds as string[],
        scheduledFor: body.scheduledFor as string | null,
        notes: body.notes as string,
        cancelledAt: null,
        cancellationReason: null,
      };
      data = { saved: true };
    } else if (
      path.endsWith(`/equipment/${ASSET}/cancel`) &&
      method === "POST"
    ) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      changes.push({ path, body });
      cancelled = true;
      schedule = {
        version: STAMP,
        responsibleFieldTechnician: null,
        auxiliaryTechnicianIds: [],
        scheduledFor: null,
        notes: null,
        cancelledAt: STAMP,
        cancellationReason: body.reason as string,
      };
      data = { saved: true };
    } else if (path === `/api/orbit/pmoc/plans/${PLAN}/executions`)
      data =
        completed || cancelled
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
        fieldTechnicians: [
          { id: "technician", name: "Marina" },
          { id: "other-technician", name: "Carlos" },
        ],
        auxiliaryTechnicians: [{ id: "assistant", name: "Joana" }],
        evidencePolicy: {
          minimumPhotos: 0,
          maximumPhotos: 6,
          acceptedKinds: ["PHOTO"],
        },
        documentPolicy: { artifactType: "PMOC" },
        procedureGroups: [{ group: "Evaporadora", items: ["Limpar filtro"] }],
        eligibility: { ready: true, blockedReasons: [] },
        existingExecution: execution(),
        schedule,
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
          status: path.includes("cycle-next-month")
            ? "NOT_STARTED"
            : cancelled
              ? "CANCELLED"
              : completed
                ? "COMPLETED"
                : started
                  ? "IN_PROGRESS"
                  : "NOT_STARTED",
          execution: path.includes("cycle-next-month") ? null : execution(),
          schedule: path.includes("cycle-next-month") ? null : schedule,
          management: {
            version: schedule?.version ?? "unplanned",
            allowedActions:
              canManage && !completed && !cancelled
                ? ["EDIT", "ASSIGN", "CANCEL"]
                : [],
          },
          eligibility: {
            ready: path.includes("cycle-next-month") || !completed,
            blockedReasons: [],
          },
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
    } else if (path === "/api/orbit/rvt/executions/visit-execution")
      data = {
        id: "visit-execution",
        status: "COMPLETED",
        startedAt: STAMP,
        completedAt: STAMP,
        responsibleFieldTechnician: { id: "technician", name: "Marina" },
        auxiliaryTechnicians: [],
        equipment: [],
        evidence: [],
        notes: {},
        customerAcknowledgement: null,
        artifact: null,
      };
    else if (path === "/api/orbit/rvt/configurations/visit-configuration")
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
  return { writes, preparations, changes };
}

test("atribui equipe e horário ao equipamento pendente sem iniciar a manutenção", async ({
  page,
}) => {
  const { changes, writes } = await setup(page);
  await page.goto(`/pmoc/${PLAN}`);
  await page.getByRole("tab", { name: "Execuções", exact: true }).click();
  await page
    .getByRole("button", { name: "Atribuir técnico", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Técnico em campo (obrigatório)").click();
  await page.getByRole("option", { name: "Carlos", exact: true }).click();
  await dialog.getByRole("checkbox", { name: "Joana" }).check();
  await dialog
    .getByLabel("Data e hora previstas (opcional)")
    .fill("2026-11-15T09:30");
  await dialog
    .getByLabel("Orientações para o atendimento (opcional)")
    .fill("Conferir filtro da sala.");
  await dialog
    .getByRole("button", { name: "Salvar execução", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(changes[0]?.body).toEqual({
    expectedVersion: "unplanned",
    responsibleFieldTechnicianId: "other-technician",
    auxiliaryTechnicianIds: ["assistant"],
    scheduledFor: "2026-11-15T12:30:00.000Z",
    notes: "Conferir filtro da sala.",
  });
  expect(
    writes.some((path) => path.endsWith(`/equipment/${ASSET}/executions`)),
  ).toBe(false);
  await expect(page.getByText("Técnico previsto: Carlos")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Atender", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Editar execução", exact: true })
    .click();
  await expect(page.getByLabel("Data e hora previstas (opcional)")).toHaveValue(
    "2026-11-15T09:30",
  );
  await expect(
    page.getByLabel("Orientações para o atendimento (opcional)"),
  ).toHaveValue("Conferir filtro da sala.");
});

test("cancelamento exige motivo, preserva o período selecionado e mantém a próxima previsão", async ({
  page,
}) => {
  const { changes } = await setup(page);
  await page.goto(`/pmoc/${PLAN}`);
  await page.getByRole("tab", { name: "Execuções", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancelar execução", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Confirmar cancelamento" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Informe o motivo");
  expect(changes).toHaveLength(0);
  await dialog
    .getByLabel("Motivo do cancelamento (obrigatório)")
    .fill("Cliente indisponível neste período");
  await dialog.getByRole("button", { name: "Confirmar cancelamento" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText(
      "Motivo do cancelamento: Cliente indisponível neste período",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Execução 1/ }),
  ).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: /Execução 2/ })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Atender", exact: true }),
  ).toHaveCount(0);
});

test("horário próximo pede confirmação antes de salvar a atribuição", async ({
  page,
}) => {
  const { changes } = await setup(page);
  await page.route("**/api/orbit/operations/schedule-check", (route) =>
    route.fulfill({
      json: {
        success: true,
        data: [
          {
            userName: "Carlos",
            title: "Outro atendimento",
            startsAt: "2026-11-15T12:05:00Z",
            endsAt: null,
          },
        ],
      },
    }),
  );
  await page.goto(`/pmoc/${PLAN}`);
  await page.getByRole("tab", { name: "Execuções", exact: true }).click();
  await page
    .getByRole("button", { name: "Atribuir técnico", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Técnico em campo (obrigatório)").click();
  await page.getByRole("option", { name: "Carlos", exact: true }).click();
  await dialog
    .getByLabel("Data e hora previstas (opcional)")
    .fill("2026-11-15T09:00");
  await dialog.getByRole("button", { name: "Salvar execução" }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Outro atendimento");
  expect(changes).toHaveLength(0);
  await confirmation
    .getByRole("button", { name: "Confirmar e continuar", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(changes).toHaveLength(1);
});

test("recusa do servidor mantém o formulário e a atribuição digitada", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/orbit/pmoc/**/schedule", (route) =>
    route.fulfill({
      status: 409,
      json: {
        success: false,
        error: {
          code: "CONFLICT",
          message:
            "Esta execução foi alterada. Atualize a página e tente novamente.",
        },
      },
    }),
  );
  await page.goto(`/pmoc/${PLAN}`);
  await page.getByRole("tab", { name: "Execuções", exact: true }).click();
  await page
    .getByRole("button", { name: "Editar execução", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Orientações para o atendimento (opcional)")
    .fill("Não perder este texto");
  await dialog.getByRole("button", { name: "Salvar execução" }).click();
  await expect(dialog.getByText(/Esta execução foi alterada/)).toBeVisible();
  await expect(
    dialog.getByLabel("Orientações para o atendimento (opcional)"),
  ).toHaveValue("Não perder este texto");
});

test("quem só consulta não recebe comandos para gerenciar ou iniciar execução", async ({
  page,
}) => {
  await setup(page, false, false);
  await page.goto(`/pmoc/${PLAN}`);
  await page.getByRole("tab", { name: "Execuções", exact: true }).click();
  await expect(
    page.getByText("Split sala principal", { exact: true }),
  ).toBeVisible();
  for (const name of [
    "Atribuir técnico",
    "Editar execução",
    "Cancelar execução",
    "Atender",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
});

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
  const next = page.getByRole("button", { name: /Execução 2/ });
  await expect(next).toBeVisible();
  await expect(next).toContainText("Próxima execução prevista");
  await expect(next).not.toHaveAttribute("aria-current", "true");
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
  // The next visit remains available, and changes only on an explicit click.
  await next.click();
  await expect(next).toHaveAttribute("aria-current", "true");
  await expect(
    page.getByRole("button", { name: "Atender", exact: true }),
  ).toBeVisible();
  await expect(report).toHaveCount(0);
  expect(writes.filter((path) => path.endsWith("/complete"))).toHaveLength(1);
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
      name: "Gerar link de assinatura (opcional)",
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

test("o detalhe da visita realizada também volta diretamente para RVT", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/rvt/execucoes/visit-execution");
  await expect(
    page.getByRole("heading", { name: "Visita técnica", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Voltar para RVT", exact: true })
    .click();
  await expect(page).toHaveURL(/\/operacoes\?secao=rvt$/);
  await expect(
    page.getByRole("tab", { name: "RVT", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

test("o retorno para RVT continua disponível se a consulta da visita falhar", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/orbit/rvt/executions/visit-execution", (route) =>
    route.fulfill({
      status: 403,
      json: {
        success: false,
        error: {
          code: "FORBIDDEN",
          message: "Você não possui permissão para realizar esta ação.",
        },
      },
    }),
  );
  await page.goto("/rvt/execucoes/visit-execution");
  await expect(
    page.getByRole("link", { name: "Voltar para RVT", exact: true }),
  ).toHaveAttribute("href", "/operacoes?secao=rvt");
});
