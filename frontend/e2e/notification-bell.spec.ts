/**
 * O sino da topbar e a foto de quem está logado.
 *
 * ## O que se prova
 *
 * Que "Notificações" saiu do menu e virou um popup no sino — com as recentes,
 * as não lidas destacadas e "Ver todas" levando à central, que continua
 * existindo por rota. E que espiar o sino **não** marca nada como lido: zerar
 * o contador de quem só queria conferir esconderia justamente o que importava.
 *
 * Prova também que a foto do perfil chega ao avatar do topo. Ele era `OR`
 * escrito à mão — nenhuma sessão, nenhuma consulta —, então trocar a foto em
 * Minha conta não mudava nada lá em cima.
 */
import { expect, test } from "@playwright/test";

import { bff, scenarioId } from "./provision";
import { assertClean, login, record, settled } from "./support";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("o sino abre as recentes e leva à central; o menu não tem mais a entrada", async ({
  page,
}) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await page.goto("/dashboard");
  await settled(page);

  /** A entrada saiu do menu lateral. */
  await expect(
    page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", {
      name: "Notificações",
    }),
  ).toHaveCount(0);

  /**
   * O cenário provisiona a própria não lida.
   *
   * Depender do que já estava no banco torna o teste refém do que outro teste
   * fez antes: uma execução que marcasse tudo como lido deixava este sem nada
   * para observar, e ele passaria por não ter o que verificar.
   */
  const marca = scenarioId().slice(0, 8);
  const eu = await bff(page, "get", "/api/orbit/identity/me");
  const meuId = ((await eu.json()).data ?? (await eu.json())).id as string;
  await bff(page, "post", "/api/orbit/notifications", {
    recipientUserId: meuId,
    type: "SYSTEM",
    channels: ["IN_APP"],
    title: `Aviso do cenário ${marca}`,
    body: "Provisionado para o teste do sino.",
  });

  await page.reload();
  await settled(page);

  const sino = page.getByRole("button", { name: /Notificações/ });
  await expect(sino).toBeVisible();

  /** O rótulo carrega a contagem: quem usa leitor de tela ouve o número. */
  const rotulo = (await sino.getAttribute("aria-label")) ?? "";
  const naoLidasAntes = Number(/(\d+)\s+não lida/.exec(rotulo)?.[1] ?? "0");

  await sino.click();

  const popup = page.getByRole("dialog");
  await expect(popup.getByText("Notificações")).toBeVisible();
  await expect(popup.getByRole("link", { name: "Ver todas" })).toBeVisible();

  /** Alguma coisa recente aparece, e não a central inteira. */
  const linhas = popup.locator("li");
  await expect(linhas.first()).toBeVisible({ timeout: 20_000 });
  expect(await linhas.count()).toBeLessThanOrEqual(5);

  /**
   * Abrir não lê.
   *
   * Marcar ao abrir zeraria o contador de quem só passou o olho, e a
   * notificação que importava sairia do destaque sem ninguém ter lido.
   *
   * A prova é a **marca na linha**, não só o número: o contador vem de uma
   * consulta em polling e pode demorar a refletir, então uma asserção só sobre
   * ele passa mesmo quando tudo acabou de ser marcado como lido — verificado
   * reintroduzindo exatamente esse defeito.
   */
  const naoLidasNoPopup = popup.locator('li [aria-label="Não lida"]');
  expect(
    await naoLidasNoPopup.count(),
    "o cenário precisa ter alguma não lida para este teste valer",
  ).toBeGreaterThan(0);

  await page.keyboard.press("Escape");
  await settled(page);
  await sino.click();
  await expect(popup.locator("li").first()).toBeVisible({ timeout: 20_000 });
  await expect(naoLidasNoPopup.first()).toBeVisible();

  const depois = (await sino.getAttribute("aria-label")) ?? "";
  const naoLidasDepois = Number(/(\d+)\s+não lida/.exec(depois)?.[1] ?? "0");
  expect(naoLidasDepois).toBe(naoLidasAntes);

  await page.keyboard.press("Escape");
  await settled(page);

  /** "Ver todas" leva à central, que continua existindo por rota. */
  await sino.click();
  await popup.getByRole("link", { name: "Ver todas" }).click();
  await page.waitForURL(/\/notificacoes/);

  assertClean(recorder, "sino de notificações");
});

test("a foto do perfil aparece no avatar do topo", async ({ page }) => {
  await login(page);
  await page.goto("/perfil?secao=dados");
  await settled(page);

  const topo = page.getByRole("button", { name: /Conta de|Minha conta/ });
  await expect(topo).toBeVisible();

  /**
   * Parte de um estado conhecido, em vez de supor que não há foto.
   *
   * Outro teste pode ter deixado uma, e supor o contrário faria este passar ou
   * reprovar pelo motivo errado — que é exatamente a fraqueza que ele existe
   * para cobrir.
   */
  const remover = page.getByRole("button", { name: "Remover" });
  if (await remover.isVisible().catch(() => false)) {
    await remover.click();
    await expect(
      page.getByTestId("profile-avatar-preview").locator("img"),
    ).toHaveCount(0, { timeout: 20_000 });
  }

  /** Sem foto, o topo mostra as iniciais de quem está logado — não um literal. */
  await expect(topo.locator("img")).toHaveCount(0, { timeout: 20_000 });

  await page.getByLabel("Escolher foto de perfil").setInputFiles({
    name: "foto.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });
  await expect(page.getByTestId("avatar-crop-viewport")).toBeVisible();
  await page.getByRole("button", { name: "Usar esta foto" }).click();

  await expect(
    page.getByTestId("profile-avatar-preview").locator("img"),
  ).toBeVisible({ timeout: 20_000 });

  /**
   * O topo acompanha **sem recarregar**.
   *
   * A troca invalida a mesma chave de cache que o topo consulta. Se cada um
   * lesse por conta própria, a pessoa trocaria a foto, continuaria vendo a
   * antiga no cabeçalho e trocaria de novo achando que não salvou.
   */
  await expect(topo.locator("img")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Remover" }).click();
  await expect(topo.locator("img")).toHaveCount(0, { timeout: 20_000 });
});
