/**
 * Temas: claro, escuro e "sistema".
 *
 * ## O que se prova
 *
 * Que a escolha **sobrevive à recarga sem piscar**. O tema escuro já existia em
 * CSS; o que faltava era poder trocar — e a armadilha de trocar é o quadro
 * claro que aparece antes da hidratação escurecer a tela, que é exatamente o
 * defeito que o menu lateral teve nesta mesma aplicação.
 *
 * Por isso a asserção não é só "a classe está lá depois que a página carregou":
 * o `<html>` é medido **antes** de qualquer script do React rodar, com o
 * documento ainda chegando.
 *
 * Prova também que o botão morto saiu: havia um ícone de "alternar painéis" sem
 * `onClick` no lugar onde o tema agora vive.
 */
import { expect, test } from "@playwright/test";

import { login, settled } from "./support";

test("a escolha de tema vale, persiste e não pisca", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await page.goto("/dashboard");
  await settled(page);

  /** O botão que não fazia nada saiu daqui. */
  await expect(
    page.getByRole("button", { name: "Alternar painéis" }),
  ).toHaveCount(0);

  const gatilho = page.getByRole("button", { name: /^Tema:/ });
  await expect(gatilho).toBeVisible();

  /** O padrão de quem nunca escolheu é seguir o sistema. */
  await expect(gatilho).toHaveAttribute("aria-label", "Tema: Sistema");

  await gatilho.click();
  await page.getByRole("menuitemcheckbox", { name: /Escuro/ }).click();

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(gatilho).toHaveAttribute("aria-label", "Tema: Escuro");

  /* ---------------------------------------------------------------- */
  /* A recarga não pisca                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Medido no **HTML servido**, e não na página já viva.
   *
   * Ler a classe do `<html>` com um locator não prova nada: o locator espera, e
   * quando ele consegue ler o React já hidratou e aplicou a classe — verificado
   * removendo o script de bootstrap, e o teste passava assim mesmo.
   *
   * O que impede o piscar é a marca chegar **no documento**, antes de qualquer
   * script do React: ou na classe que o servidor escreveu (escolha explícita),
   * ou no script síncrono do `<head>` (quando a escolha é seguir o sistema).
   */
  const documento = await page.request.get("/dashboard");
  const html = await documento.text();
  const tagHtml = /<html[^>]*>/.exec(html)?.[0] ?? "";

  /**
   * A **classe**, e não a tag inteira.
   *
   * Procurar "dark" na tag casava com `style="color-scheme:dark"`, que o
   * servidor também manda — e que deixa barra de rolagem e controles nativos
   * escuros sem aplicar nenhum token do tema. A página continuaria clara.
   * Verificado removendo a classe: com a asserção antiga o teste passava.
   */
  const classe = /class="([^"]*)"/.exec(tagHtml)?.[1] ?? "";
  expect(
    classe.split(/\s+/),
    "o servidor precisa mandar a classe do tema no primeiro quadro",
  ).toContain("dark");
  expect(
    html,
    "e o script que resolve 'sistema' antes da primeira pintura",
  ).toContain("prefers-color-scheme");

  await page.goto("/dashboard");
  await settled(page);
  await expect(page.locator("html")).toHaveClass(/dark/);

  /* ---------------------------------------------------------------- */
  /* E dá para voltar                                                  */
  /* ---------------------------------------------------------------- */

  await page.getByRole("button", { name: /^Tema:/ }).click();
  await page.getByRole("menuitemcheckbox", { name: /Claro/ }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  await page.reload();
  await settled(page);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("em Sistema, o tema do computador manda", async ({ browser }) => {
  /**
   * Um contexto que se declara escuro no nível do sistema.
   *
   * É o caminho que mais gente percorre — ninguém escolhe tema no primeiro
   * acesso — e o único jeito de exercitá-lo é fingir o sistema operacional.
   */
  const contexto = await browser.newContext({ colorScheme: "dark" });
  const page = await contexto.newPage();

  await login(page);
  await page.goto("/dashboard");
  await settled(page);

  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: /^Tema:/ })).toHaveAttribute(
    "aria-label",
    "Tema: Sistema",
  );

  await contexto.close();
});
