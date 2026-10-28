import { expect, test, type Page } from "@playwright/test";
const stamp = "2026-10-28T12:00:00Z";
async function setup(page: Page) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const claims = {
    sub: "owner",
    sid: "conversion-test",
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
  const quote = {
    id: "quote-1",
    number: 42,
    code: "ORC-42",
    status: "APPROVED",
    title: "Manutenção preventiva",
    notes: null,
    introText: null,
    validUntil: "2099-12-31",
    isExpired: false,
    currency: "BRL",
    subtotal: "100.00",
    discount: "0.00",
    discountReason: null,
    total: "100.00",
    customer: { id: "customer", displayName: "Cliente Aurora" },
    businessUnit: { id: "unit", name: "Matriz" },
    serviceAddress: {
      id: "address-1",
      label: "Loja Centro",
      summary: "Rua da Aurora, 20",
    },
    responsible: null,
    assets: [
      {
        id: "asset-1",
        name: "Split recepção",
        identifier: "EQP-000001",
        location: "Recepção",
      },
    ],
    items: [],
    itemCount: 1,
    transitions: {
      canEdit: false,
      canSend: false,
      canApprove: false,
      canReject: false,
      canCancel: false,
      canConvert: true,
    },
    operation: null,
    convertedAt: null,
    sentAt: stamp,
    sentBy: { id: "owner", displayName: "Marina" },
    decidedAt: stamp,
    decidedBy: null,
    closingReason: null,
    expiredAt: null,
    cancelledAt: null,
    createdBy: { id: "owner", displayName: "Marina" },
    createdAt: stamp,
    updatedAt: stamp,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let data: unknown = {
      data: [],
      meta: { total: 0, page: 1, limit: 20, totalPages: 0 },
      unread: 0,
    };
    if (request.method() === "POST")
      writes.push({
        path,
        body: request.postDataJSON() as Record<string, unknown>,
      });
    if (path === "/api/auth/session")
      data = {
        authenticated: true,
        user: {
          id: "owner",
          firstName: "Marina",
          displayName: "Marina",
          welcomeDismissedAt: stamp,
          timezone: "America/Recife",
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
    else if (path === "/api/orbit/quotes/quote-1") data = quote;
    else if (path.endsWith("/customer-response")) data = null;
    else if (path.endsWith("/timeline")) data = [];
    else if (path.endsWith("/field-technicians"))
      data = [{ id: "tech", name: "Carlos Operacional" }];
    else if (path.endsWith("/field-assistants"))
      data = [{ id: "aux", name: "Joana Auxiliar" }];
    else if (path.endsWith("/addresses"))
      data = [
        {
          id: "address-1",
          label: "Loja Centro",
          street: "Rua da Aurora",
          number: "20",
          city: "Recife",
          stateCode: "PE",
          isActive: true,
          isPrimary: true,
        },
      ];
    else if (path.endsWith("/schedule-check"))
      data = [
        {
          userName: "Carlos Operacional",
          title: "OS-ANTERIOR · Visita agendada",
          startsAt: "2026-11-20T15:55:00Z",
          endsAt: "2026-11-20T17:00:00Z",
        },
      ];
    else if (path.endsWith("/convert-to-operation")) data = quote;
    else if (path === "/api/orbit/operations" && request.method() === "POST")
      data = { id: "operation-created" };
    await route.fulfill({ json: { success: true, data } });
  });
  return writes;
}
test("conversão coleta equipe, endereço e agenda; conflito pede confirmação e cancelar não cria operação", async ({
  page,
}) => {
  const writes = await setup(page);
  await page.goto("/orcamentos/quote-1");
  await page
    .getByRole("button", { name: "Converter em operação", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "Converter orçamento em operação",
  });
  await expect(
    modal.getByText("Split recepção", { exact: true }),
  ).toBeVisible();
  await expect(modal.getByText("R$ 100,00", { exact: true })).toBeVisible();
  const visibility = modal.getByRole("checkbox", {
    name: "Permitir que o técnico em campo veja o valor",
  });
  await expect(visibility).not.toBeChecked();
  await visibility.check();
  await expect(modal.locator("#operation-address")).toContainText(
    "Loja Centro",
  );
  await modal.locator("#operation-responsible").click();
  await page.getByRole("option", { name: "Carlos Operacional" }).click();
  await modal.locator("#operation-auxiliary").click();
  await page.getByRole("option", { name: "Joana Auxiliar" }).click();
  await modal.locator("#quote-convert-start").fill("2026-11-20T13:00");
  await modal.locator("#quote-convert-end").fill("2026-11-20T14:00");
  await modal.locator("#quote-convert-sector").fill("Recepção");
  await modal
    .getByRole("button", { name: "Criar operação", exact: true })
    .click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("Carlos Operacional");
  await expect(confirmation).toContainText("até 10 minutos");
  expect(
    writes.filter((item) => item.path.endsWith("/convert-to-operation")),
  ).toHaveLength(0);
  await confirmation
    .getByRole("button", { name: "Voltar", exact: true })
    .click();
  await expect(modal.locator("#quote-convert-sector")).toHaveValue("Recepção");
  await modal
    .getByRole("button", { name: "Criar operação", exact: true })
    .click();
  await confirmation
    .getByRole("button", { name: "Confirmar e continuar" })
    .click();
  await expect
    .poll(
      () =>
        writes.filter((item) => item.path.endsWith("/convert-to-operation"))
          .length,
    )
    .toBe(1);
  const sent = writes.find((item) =>
    item.path.endsWith("/convert-to-operation"),
  )!.body;
  expect(sent).toMatchObject({
    responsibleFieldTechnicianId: "tech",
    auxiliaryTechnicianIds: ["aux"],
    customerAddressId: "address-1",
    sector: "Recepção",
    amountVisibleInField: true,
    scheduledStart: "2026-11-20T16:00:00.000Z",
    scheduledEnd: "2026-11-20T17:00:00.000Z",
  });
  expect(
    writes.filter((item) => item.path.endsWith("/schedule-check")),
  ).toHaveLength(2);
});

test("wizard de operação também confirma a agenda antes de criar", async ({
  page,
}) => {
  const writes = await setup(page);
  await page.goto("/operacoes");
  await page
    .getByRole("button", { name: /Nova opera/i })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await dialog.locator("#operation-title").fill("Atendimento agendado");
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await dialog.locator("#operation-start").fill("2026-11-20T13:00");
  await dialog.locator("#operation-end").fill("2026-11-20T14:00");
  await dialog.locator("#operation-responsible").click();
  await page.getByRole("option", { name: "Carlos Operacional" }).click();
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await dialog.getByRole("button", { name: "Continuar", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Criar operação", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(
    writes.filter((item) => item.path === "/api/orbit/operations"),
  ).toHaveLength(0);
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Confirmar e continuar" })
    .click();
  await expect
    .poll(
      () =>
        writes.filter((item) => item.path === "/api/orbit/operations").length,
    )
    .toBe(1);
  expect(
    writes.find((item) => item.path === "/api/orbit/operations")!.body,
  ).toMatchObject({
    title: "Atendimento agendado",
    responsibleFieldTechnicianId: "tech",
    scheduledStart: "2026-11-20T16:00:00.000Z",
  });
});
