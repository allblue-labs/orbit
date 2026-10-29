import { expect, test, type Page } from "@playwright/test";

const TOKEN = "Ab3_".repeat(16);
const proposal = {
  code: "ORC-000042",
  title: "Manutenção preventiva",
  customerName: "Cliente Aurora",
  emitterName: "Clima Norte",
  introText: "Proposta para manutenção dos equipamentos da unidade.",
  notes: "Pagamento após aprovação.",
  validUntil: "2099-12-31",
  currency: "BRL",
  subtotal: "300.00",
  discount: "50.00",
  total: "250.00",
  serviceAddress: "Rua da Aurora, 100 · Recife/PE",
  equipment: [
    { name: "Split sala principal", identifier: "EQP-1", location: "Sala" },
  ],
  items: [
    {
      description: "Limpeza, manutenção e testes de funcionamento",
      quantity: "2",
      unit: "UN",
      unitPrice: "150.00",
      discount: "0.00",
      total: "300.00",
      notes: null,
    },
  ],
};
async function setup(page: Page, state = "AVAILABLE") {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/document")) {
      return route.fulfill({
        contentType: "application/pdf",
        headers: {
          "Content-Disposition": 'attachment; filename="proposta.pdf"',
        },
        body: "%PDF-1.7\n%%EOF",
      });
    }
    if (path.includes("/public/quotes/proposals/")) {
      let response = null;
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        writes.push(body);
        response = {
          decision: body.decision,
          signerName: body.signerName,
          respondedAt: "2026-10-28T12:00:00Z",
          reason: body.reason ?? null,
        };
      }
      return route.fulfill({
        json: {
          success: true,
          data: {
            state: response ? "COMPLETED" : state,
            proposal: state === "AVAILABLE" ? proposal : null,
            expiresAt: "2099-12-31T12:00:00Z",
            response,
          },
        },
      });
    }
    if (path.includes("/public/pmoc/contracts/")) {
      const data = path.endsWith("/signature")
        ? { state: "VALIDO", reason: null }
        : {
            state: "VALIDO",
            reason: null,
            documentAvailable: true,
            signature: null,
            plan: {
              code: "PMOC-42",
              name: "Contrato preventivo",
              startsOn: "2026-10-01",
              endsOn: null,
              frequency: "Mensal",
              coveredEquipment: 2,
              technicalResponsible: "Ana Técnica",
            },
            customer: { name: "Cliente Aurora" },
            emitter: { name: "Clima Norte" },
            expiresAt: "2099-12-31T12:00:00Z",
          };
      if (route.request().method() === "POST")
        writes.push(route.request().postDataJSON());
      return route.fulfill({ json: { success: true, data } });
    }
    return route.fulfill({ json: { success: true, data: null } });
  });
  return writes;
}
async function draw(page: Page) {
  const canvas = page.locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 25, box.y + 75);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 25, { steps: 8 });
  await page.mouse.move(box.x + 125, box.y + 105, { steps: 8 });
  await page.mouse.move(box.x + 200, box.y + 45, { steps: 8 });
  await page.mouse.up();
}
test.use({
  viewport: { width: 390, height: 844 },
  storageState: { cookies: [], origins: [] },
});

test("cliente confere, baixa e aprova com assinatura no celular sem login", async ({
  page,
}) => {
  const writes = await setup(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(`/proposta/${TOKEN}`);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(
    page.getByRole("heading", { name: "Manutenção preventiva" }),
  ).toBeVisible();
  await expect(
    page.getByText("Cliente Aurora", { exact: false }).first(),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Baixar orçamento em PDF" }).click();
  expect((await download).suggestedFilename()).toBe("proposta.pdf");
  const submit = page.getByRole("button", {
    name: "Assinar e aprovar orçamento",
  });
  await expect(submit).toBeDisabled();
  await page.getByLabel("Seu nome completo").fill("Mariana Cliente");
  await draw(page);
  await page.getByRole("checkbox").check();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(
    page.getByRole("heading", {
      name: "Orçamento aprovado e assinatura registrada",
    }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  const signedDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar orçamento assinado em PDF" })
    .click();
  await signedDownload;
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    decision: "APPROVE",
    signerName: "Mariana Cliente",
    consentAccepted: true,
  });
  expect(writes[0]!.signatureBase64).toMatch(/^data:image\/png;base64,/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
for (const [option, submit, confirmation, decision] of [
  [
    "Pedir alterações",
    "Enviar pedido de alterações",
    "Pedido de alterações enviado",
    "REQUEST_CHANGES",
  ],
  ["Recusar proposta", "Confirmar recusa", "Recusa registrada", "REJECT"],
]) {
  test(`cliente pode ${option!.toLowerCase()} com motivo`, async ({ page }) => {
    const writes = await setup(page);
    await page.goto(`/proposta/${TOKEN}`);
    await page.getByRole("button", { name: option, exact: true }).click();
    await page.getByLabel("Seu nome completo").fill("Mariana Cliente");
    await expect(
      page.getByRole("button", { name: submit, exact: true }),
    ).toBeDisabled();
    await page
      .locator("textarea")
      .fill("Precisamos rever os equipamentos e o prazo.");
    await page.getByRole("button", { name: submit, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: confirmation, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Baixar orçamento assinado em PDF" }),
    ).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      decision,
      reason: "Precisamos rever os equipamentos e o prazo.",
    });
    expect(writes[0]!.signatureBase64).toBeUndefined();
  });
}
test("link expirado não exibe proposta ou coleta assinatura", async ({
  page,
}) => {
  await setup(page, "EXPIRED");
  await page.goto(`/proposta/${TOKEN}`);
  await expect(
    page.getByRole("heading", { name: "O prazo deste link terminou" }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(
    page.getByText("Manutenção preventiva", { exact: true }),
  ).toHaveCount(0);
});
test("contrato PMOC permite leitura, download e assinatura pelo celular", async ({
  page,
}) => {
  const writes = await setup(page);
  await page.goto(`/contrato/${TOKEN}`);
  await expect(
    page.getByRole("heading", { name: "Contrato preventivo" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Baixar contrato completo em PDF" })
    .click();
  await download;
  await page.getByLabel("Nome de quem assina").fill("Mariana Cliente");
  await draw(page);
  await page
    .getByRole("button", { name: "Assinar contrato", exact: true })
    .click();
  await expect(
    page.getByText("Contrato assinado", { exact: true }),
  ).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]!.signatureBase64).toMatch(/^data:image\/png;base64,/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
