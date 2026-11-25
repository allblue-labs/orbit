import { test, expect } from "@playwright/test";
import { login, settled } from "./support";
import { activeBusinessUnit, bff, scenarioId } from "./provision";

// Visibility belongs to each proposal, rather than to a global staff grant.
test("owner libera e revoga o orçamento no aplicativo sem alterar a proposta", async ({
  page,
}) => {
  await login(page);
  const businessUnitId = await activeBusinessUnit(page);
  const suffix = scenarioId();
  const customerResponse = await bff(page, "post", "/api/orbit/customers", {
    type: "COMPANY",
    legalName: `Cliente documentos ${suffix}`,
  });
  expect(customerResponse.ok(), await customerResponse.text()).toBe(true);
  const customer = (await customerResponse.json()).data as { id: string };
  const created = await bff(page, "post", "/api/orbit/quotes", {
    customerId: customer.id,
    businessUnitId,
    title: `Proposta documentos ${suffix}`,
  });
  expect(created.ok(), await created.text()).toBe(true);
  const quote = (await created.json()).data as {
    id: string;
    updatedAt: string;
    mobileVisible: boolean;
  };
  expect(quote.mobileVisible).toBe(false);
  await page.goto(`/orcamentos/${quote.id}`);
  await settled(page);
  const toggle = page.getByRole("switch", {
    name: "Liberar para outros usuários no app",
    exact: true,
  });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  for (const enabled of [true, false]) {
    const response = page.waitForResponse(
      (reply) =>
        reply.url().endsWith(`/quotes/${quote.id}/mobile-access`) &&
        reply.request().method() === "PATCH",
    );
    await toggle.click();
    expect((await response).status()).toBe(200);
    if (enabled) await expect(toggle).toBeChecked();
    else await expect(toggle).not.toBeChecked();
    await page.reload();
    if (enabled) await expect(toggle).toBeChecked();
    else await expect(toggle).not.toBeChecked();
    const saved = await bff(page, "get", `/api/orbit/quotes/${quote.id}`);
    expect(saved.ok(), await saved.text()).toBe(true);
    expect((await saved.json()).data).toMatchObject({
      mobileVisible: enabled,
      updatedAt: quote.updatedAt,
      status: "DRAFT",
    });
  }
});
