import { test, expect } from "@playwright/test";
import { login, settled } from "./support";
import { bff, scenarioId } from "./provision";

const permission = "mobile.quotes.documents.read";
const label = "Visualizar orçamentos em Documentos no app";

test("owner libera documentos de orçamento no cadastro e pode revogar na edição", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1200 });
  await login(page);
  await page.goto("/equipe");
  await settled(page);
  await page
    .getByRole("button", { name: "Cadastrar usuário", exact: true })
    .click();
  const suffix = scenarioId();
  await page.locator("#member-first-name").fill("Orcamentos");
  await page.locator("#member-last-name").fill(suffix);
  await page.locator("#member-email").focus();
  await page.locator("#member-email").fill(`documentos.${suffix}`);
  const email = await page.locator("#member-email").inputValue();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.locator("#member-role").click();
  await page
    .getByRole("option", { name: "Técnico Operacional", exact: true })
    .click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  const toggle = page.getByRole("switch", { name: label, exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("button", { name: "Cadastrar", exact: true }).click();
  await expect(page.getByTestId("temporary-password")).toBeVisible();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  const response = await bff(
    page,
    "get",
    "/api/orbit/organizations/current/members?limit=100",
  );
  expect(response.ok(), await response.text()).toBe(true);
  const members = (await response.json()).data.data as {
    userId: string;
    email: string;
    access: { permissions: string[] };
  }[];
  const member = members.find((candidate) => candidate.email === email)!;
  expect(member).toBeTruthy();
  expect(member.access.permissions).toContain(permission);
  await page.goto(`/equipe/membros/${member.userId}`);
  await page
    .getByRole("button", { name: "Editar usuário", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const editToggle = dialog.getByRole("switch", { name: label, exact: true });
  await expect(editToggle).toBeChecked();
  await editToggle.click();
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const saved = await bff(
    page,
    "get",
    `/api/orbit/organizations/current/members/${member.userId}`,
  );
  expect(saved.ok(), await saved.text()).toBe(true);
  expect((await saved.json()).data.access.permissions).not.toContain(
    permission,
  );
});
