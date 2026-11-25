import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

import { login } from "./support";

async function createReminder(page: Page, title: string) {
  await page.getByRole("button", { name: "Novo lembrete" }).click();
  const dialog = page.getByRole("dialog", { name: "Novo lembrete" });
  await dialog.getByLabel(/O que lembrar/).fill(title);
  const [response] = await Promise.all([
    page.waitForResponse(
      (result) =>
        result.request().method() === "POST" &&
        new URL(result.url()).pathname === "/api/orbit/scheduling/events",
    ),
    dialog.getByRole("button", { name: "Criar lembrete" }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(dialog).toBeHidden();
  return (await response.json()).data.calendarId as string;
}

test("Lembretes usa a agenda padrão, exclui eventos comuns e permite trocar de calendário", async ({
  page,
}) => {
  await login(page);

  const nonce = randomUUID().slice(0, 8);
  const defaultName = `Agenda de atendimento ${nonce}`;
  const alternateName = `Agenda de retornos ${nonce}`;
  const ordinaryTitle = `Compromisso comum ${nonce}`;
  const firstReminder = `Revisar cliente ${nonce}`;
  const secondReminder = `Revisar equipamento ${nonce}`;

  const calendarId = await page.evaluate(
    async ({ defaultName, ordinaryTitle, nonce }) => {
      const session = await fetch("/api/auth/session");
      const { scope } = (await session.json()).data;
      const businessUnitId = scope.businessUnitId ?? scope.businessUnitIds[0];
      const post = async (path: string, body: object) => {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!response.ok)
          throw new Error(
            `Falha ao preparar a agenda (HTTP ${response.status})`,
          );
        return (await response.json()).data;
      };
      const calendar = await post("/api/orbit/scheduling/calendars", {
        name: defaultName,
        key: `AGENDA_TESTE_${nonce}`,
        timezone: "America/Recife",
        businessUnitId,
        isDefault: true,
        isActive: true,
      });
      const start = new Date(Date.now() + 7 * 24 * 60 * 60_000);
      await post("/api/orbit/scheduling/events", {
        calendarId: calendar.id,
        businessUnitId,
        title: ordinaryTitle,
        type: "COMPROMISSO",
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 30 * 60_000).toISOString(),
        timezone: "America/Recife",
        sourceModule: "scheduling",
        sourceEntityType: "MANUAL",
      });
      return calendar.id as string;
    },
    { defaultName, ordinaryTitle, nonce },
  );

  await page.goto("/agenda");
  await page.getByRole("tab", { name: "Lembretes" }).click();
  await expect(
    page.getByText(defaultName, { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Criar calendário" }),
  ).toBeHidden();
  await expect(
    page.getByText("Nenhum lembrete nos próximos doze meses"),
  ).toBeVisible();
  expect(await createReminder(page, firstReminder)).toBe(calendarId);
  await expect(page.getByText(firstReminder, { exact: true })).toBeVisible();
  await expect(page.getByText(ordinaryTitle, { exact: true })).toBeHidden();

  await page
    .getByRole("button", { name: "Novo calendário", exact: true })
    .click();
  await page.locator("#calendar-name").fill(alternateName);
  const [response] = await Promise.all([
    page.waitForResponse(
      (result) =>
        result.request().method() === "POST" &&
        new URL(result.url()).pathname === "/api/orbit/scheduling/calendars",
    ),
    page.getByRole("button", { name: "Criar calendário" }).click(),
  ]);
  expect(response.ok()).toBe(true);
  const alternate = (await response.json()).data as {
    id: string;
    isDefault: boolean;
  };
  expect(alternate.isDefault).toBe(false);

  const picker = page.getByRole("combobox", {
    name: "Calendário dos lembretes",
  });
  await expect(picker).toContainText(alternateName);
  expect(await createReminder(page, secondReminder)).toBe(alternate.id);
  await expect(page.getByText(secondReminder, { exact: true })).toBeVisible();
  await expect(page.getByText(firstReminder, { exact: true })).toBeHidden();

  await picker.click();
  await page.getByRole("option", { name: `${defaultName} · padrão` }).click();
  await expect(page.getByText(firstReminder, { exact: true })).toBeVisible();
  await expect(page.getByText(secondReminder, { exact: true })).toBeHidden();
  await expect(page.getByText(ordinaryTitle, { exact: true })).toBeHidden();
});
