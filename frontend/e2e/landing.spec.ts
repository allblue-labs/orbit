/**
 * A landing pública.
 *
 * ## O que se prova
 *
 * Que a página descreve o Orbit em vez de descrever um SaaS qualquer. Ela era
 * o formato que toda landing de software tem — crachá, manchete com palavra em
 * gradiente, três números inventados e seis cartões de recurso genérico — e
 * passou a seguir a cronologia real de um atendimento de campo.
 *
 * Prova também as duas coisas que quebram calado: que nada nasce invisível
 * esperando o JavaScript, e que a marca não volta a ser uma chapa branca.
 */
import { expect, test } from "@playwright/test";

import { assertClean, record, settled } from "./support";

/** A landing é pública: nenhuma sessão, como o visitante a encontra. */
test.use({ storageState: { cookies: [], origins: [] } });

const ETAPAS = [
  "O plano gera a visita",
  "O técnico recebe em campo",
  "O roteiro é preenchido",
  "O cliente confere e assina",
  "O documento sai pronto",
] as const;

test("a página conta a cadeia de um atendimento, na ordem", async ({ page }) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await settled(page);

  const etapas = page.getByRole("list").filter({ hasText: ETAPAS[0] }).first();
  await expect(etapas.getByRole("listitem")).toHaveCount(ETAPAS.length);

  /**
   * A ordem é o conteúdo.
   *
   * Numerar cinco cartões só significa alguma coisa se eles estiverem na
   * sequência do trabalho. Conferir os títulos em ordem é o que impede a lista
   * de virar uma grade de recursos com números decorativos.
   */
  await expect(etapas.getByRole("listitem")).toHaveText(
    ETAPAS.map((titulo) => new RegExp(titulo)),
  );

  assertClean(recorder, "landing");
});

test("nada na página nasce invisível esperando o JavaScript", async ({
  request,
}) => {
  /**
   * A regressão que este teste tranca.
   *
   * As revelações por rolagem partiam de `opacity: 0`, e o Next grava esse
   * estilo **inline no HTML servido**. Até o JavaScript assumir, a página de
   * marketing inteira ficava em branco — e se ele falhasse, ficava em branco
   * para sempre. O robô de busca lia o texto; a pessoa via nada.
   *
   * Lido do HTML cru, e não do DOM já hidratado: no navegador o defeito se
   * corrige sozinho em milissegundos e o teste passaria sem provar nada.
   */
  const resposta = await request.get("/");
  expect(resposta.ok(), await resposta.text()).toBe(true);
  const html = await resposta.text();

  expect(html).toContain("O plano gera a visita");
  expect(html).not.toMatch(/opacity:\s*0[^.\d]/);
});

test("a marca aparece sem chapa, e com uma tinta para cada tema", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await settled(page);

  const marca = page.locator("header a[aria-label='Orbit — início']");

  /**
   * A arte vinha dentro de um cartão branco com anel e sombra: no header claro
   * virava um adesivo colado, e no escuro, uma laje branca. O PNG sempre teve
   * alfa — o que faltava era a tinta clara, não a chapa.
   */
  const fundo = await marca
    .locator("span")
    .first()
    .evaluate((elemento) => {
      const estilo = getComputedStyle(elemento);
      return { cor: estilo.backgroundColor, sombra: estilo.boxShadow };
    });
  expect(fundo.cor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(fundo.sombra).toBe("none");

  /** Duas tintas, trocadas por CSS: uma some no tema em que não serve. */
  await expect(marca.locator("img")).toHaveCount(2);
});

test("a marca continua tendo nome nos dois temas", async ({ page }) => {
  /**
   * A regressão que este teste tranca.
   *
   * A tinta que não serve ao tema é escondida com `display:none`, e isso a tira
   * da árvore de acessibilidade junto com o texto alternativo dela. Com o nome
   * em cada imagem, no escuro sobrava só a tinta escura — marcada como
   * decorativa — e a marca ficava anônima.
   *
   * O rodapé é onde isso aparece: no header a marca está dentro de um link já
   * rotulado, que disfarça o defeito.
   */
  await page.setViewportSize({ width: 1440, height: 900 });

  for (const tema of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: tema });
    await page.goto("/");
    await settled(page);

    const noRodape = page.getByRole("contentinfo").getByRole("img");
    await expect(noRodape, `tema ${tema}`).toHaveAccessibleName(
      "Orbit Operations ERP",
    );
  }
});

for (const largura of [375, 768, 1440]) {
  test(`a landing cabe em ${largura} sem vazar horizontalmente`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: largura, height: 900 });
    await page.goto("/");
    await settled(page);

    /* Revela tudo antes de medir: seção escondida não vaza. */
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      window.scrollTo(0, 0);
    });

    const vazou = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(vazou).toBe(false);
  });
}
