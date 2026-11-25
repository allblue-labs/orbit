import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
test.use({ storageState: { cookies: [], origins: [] } });
async function fill(page: import("@playwright/test").Page) {
  const form = page.getByRole("form", { name: "Feedback e suporte" });
  await form.getByLabel("Nome *", { exact: true }).fill("Pessoa de teste");
  await form
    .getByLabel("E-mail *", { exact: true })
    .fill(`visitor.${randomUUID()}@example.test`);
  await form
    .getByLabel("Mensagem *", { exact: true })
    .fill("Preciso de ajuda para organizar meus atendimentos.");
  return form;
}
test("formulário envia feedback com loading e destinatário fixo no servidor", async ({
  page,
}) => {
  let payload: Record<string, unknown> = {};
  let key = "";
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/orbit/public/contact", async (route) => {
    payload = route.request().postDataJSON() as Record<string, unknown>;
    key = route.request().headers()["idempotency-key"] ?? "";
    await gate;
    await route.fulfill({
      status: 202,
      json: { success: true, data: { message: "Mensagem recebida." } },
    });
  });
  await page.goto("/#contato");
  const form = await fill(page);
  await form.getByLabel("Assunto *", { exact: true }).selectOption("FEEDBACK");
  await form
    .getByRole("button", { name: "Enviar mensagem", exact: true })
    .click();
  await expect(
    form.getByRole("button", { name: "Enviando mensagem…", exact: true }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole("heading", { name: "Mensagem recebida", exact: true }),
  ).toBeVisible();
  expect(payload.topic).toBe("FEEDBACK");
  expect(payload).not.toHaveProperty("to");
  expect(payload).not.toHaveProperty("from");
  expect(key).toMatch(
    /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i,
  );
});
test("o formulário anônimo atravessa o BFF real e persiste a solicitação", async ({
  page,
}) => {
  await page.goto("/#contato");
  const form = await fill(page);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/orbit/public/contact") &&
      r.request().method() === "POST",
  );
  await form
    .getByRole("button", { name: "Enviar mensagem", exact: true })
    .click();
  const received = await response;
  expect(received.status()).toBe(202);
  const correlationId = received.headers()["x-correlation-id"];
  expect(correlationId).toMatch(/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i);
  expect(received.headers()["x-request-id"]).toBe(correlationId);
  await expect(
    page.getByRole("heading", { name: "Mensagem recebida", exact: true }),
  ).toBeVisible();
});
test("uma falha permite tentar novamente usando a mesma chave de envio", async ({
  page,
}) => {
  const keys: string[] = [];
  await page.route("**/api/orbit/public/contact", async (route) => {
    keys.push(route.request().headers()["idempotency-key"] ?? "");
    await route.fulfill(
      keys.length === 1
        ? {
            status: 503,
            json: {
              success: false,
              error: {
                code: "PUBLIC_CONTACT_UNAVAILABLE",
                message: "O formulário está temporariamente indisponível.",
              },
            },
          }
        : { status: 202, json: { success: true, data: {} } },
    );
  });
  await page.goto("/#contato");
  const form = await fill(page);
  await form
    .getByRole("button", { name: "Enviar mensagem", exact: true })
    .click();
  await expect(
    form.getByText("O formulário está temporariamente indisponível."),
  ).toBeVisible();
  await form
    .getByRole("button", { name: "Enviar mensagem", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Mensagem recebida", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});
test("validação fica em português e não envia campos inválidos", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/orbit/public/contact", (route) => {
    requests++;
    return route.fulfill({ status: 202, json: {} });
  });
  await page.goto("/#contato");
  const form = page.getByRole("form", { name: "Feedback e suporte" });
  await form
    .getByRole("button", { name: "Enviar mensagem", exact: true })
    .click();
  await expect(
    form.getByText("Informe um endereço de e-mail válido."),
  ).toBeVisible();
  expect(requests).toBe(0);
});
test("a seção de contato cabe no celular e mantém os campos acessíveis", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto("/#contato");
  const section = page.locator("#contato");
  await expect(section.getByLabel("Mensagem *", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await section.screenshot({
    path: test.info().outputPath("contact-mobile.png"),
  });
});
