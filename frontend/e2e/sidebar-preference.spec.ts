/**
 * A barra lateral entre páginas.
 *
 * ## O que se prova aqui
 *
 * Dois defeitos que a navegação manual revelava e nenhum teste pegava: a
 * barra voltava ao estado recolhido a cada página, e o caminho até lá era
 * visível — ela abria e fechava num piscar. A causa era a mesma: `AppShell`
 * é montado por página, então a `Sidebar` remontava com o estado padrão.
 *
 * O piscar é medido, não observado: um amostrador registra a largura a cada
 * quadro durante a navegação. Uma asserção só no estado final passaria mesmo
 * com o piscar de volta.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

const LARGURA_RECOLHIDA = 84;
const LARGURA_ABERTA = 276;

const aside = (page: Page) => page.locator("aside");

/** O valor gravado na preferência, ou `(ausente)`. */
const escolha = (cookies: { name: string; value: string }[]) =>
  cookies.find((cookie) => cookie.name === "orbit_sidebar")?.value ??
  "(ausente)";

async function expandir(page: Page) {
  await page.getByRole("button", { name: "Expandir menu lateral" }).click();
  await expect(
    page.getByRole("button", { name: "Recolher menu lateral" }),
  ).toBeVisible();
}

/**
 * Registra a largura da barra a cada quadro.
 *
 * `-1` quando a barra não está na árvore: some e volta também é piscar, e
 * uma amostragem que ignorasse a ausência não veria isso.
 *
 * A navegação do produto é *soft* — o documento é o mesmo —, então instalar
 * por `evaluate` basta e o amostrador atravessa a troca de página.
 */
async function instalarAmostrador(page: Page) {
  await page.evaluate(() => {
    const janela = window as unknown as { __larguras?: number[] };
    janela.__larguras = [];
    const passo = () => {
      const barra = document.querySelector("aside");
      janela.__larguras!.push(
        barra ? Math.round(barra.getBoundingClientRect().width) : -1,
      );
      requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  });
}

async function larguras(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as unknown as { __larguras?: number[] }).__larguras ?? [],
  );
}

test.describe("preferência da barra lateral", () => {
  test("a escolha sobrevive à navegação, sem piscar no caminho", async ({
    page,
  }) => {
    const recorder = record(page);

    await login(page);
    await page.goto("/dashboard");
    await settled(page);

    await expandir(page);
    await expect(aside(page)).toHaveJSProperty("offsetWidth", LARGURA_ABERTA);

    /// Deixa a animação de abrir terminar antes de medir. Sem esta espera o
    /// amostrador pega o fim dela e acusa um piscar que foi o teste que
    /// provocou.
    await page.waitForTimeout(600);
    await instalarAmostrador(page);

    /// A navegação é por link, como a de quem usa.
    await page.getByRole("link", { name: "Clientes" }).first().click();
    await page.waitForURL("**/clientes");
    await settled(page);

    /// Continua aberta na página nova.
    await expect(aside(page)).toHaveJSProperty("offsetWidth", LARGURA_ABERTA);

    /// E nunca passou pelo recolhido no caminho: é isso que o olho via.
    const medidas = await larguras(page);
    expect(medidas.length).toBeGreaterThan(2);

    /// Nem recolheu, nem sumiu: `-1` marca ausência da árvore, e qualquer
    /// valor perto de 84 seria o estado padrão voltando na remontagem.
    expect(medidas).not.toContain(-1);
    expect(Math.min(...medidas)).toBeGreaterThan(LARGURA_RECOLHIDA + 10);

    assertClean(recorder, "navegação com a barra aberta");
  });

  test("a escolha sobrevive a recarregar a página", async ({ page }) => {
    /// Sem o cookie, o estado morreria no F5 — e o primeiro quadro voltaria
    /// a sair errado, que é a outra metade do piscar.
    const recorder = record(page);

    await login(page);
    await page.goto("/dashboard");
    await settled(page);

    await expandir(page);
    await page.reload();
    await settled(page);

    await expect(aside(page)).toHaveJSProperty("offsetWidth", LARGURA_ABERTA);

    assertClean(recorder, "recarga com a barra aberta");
  });

  test("recolher também é lembrado", async ({ page }) => {
    /**
     * Aqui a asserção é sobre o **cookie**, e não sobre a largura final.
     *
     * Recolhido é o padrão: uma asserção de largura passaria mesmo sem
     * persistência nenhuma — foi o que aconteceu quando este teste foi
     * escrito assim e o defeito foi reintroduzido de propósito para
     * conferir. O cookie é o que distingue "lembrou" de "caiu no padrão".
     */
    const recorder = record(page);

    await login(page);
    await page.goto("/dashboard");
    await settled(page);

    await expandir(page);
    await expect(
      page.context().cookies().then(escolha),
    ).resolves.toBe("0");

    await page.getByRole("button", { name: "Recolher menu lateral" }).click();
    await expect(
      page.getByRole("button", { name: "Expandir menu lateral" }),
    ).toBeVisible();
    await expect(
      page.context().cookies().then(escolha),
    ).resolves.toBe("1");

    await page.reload();
    await settled(page);

    await expect(aside(page)).toHaveJSProperty(
      "offsetWidth",
      LARGURA_RECOLHIDA,
    );

    assertClean(recorder, "recarga com a barra recolhida");
  });
});
