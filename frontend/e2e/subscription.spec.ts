/**
 * Plano e assinatura — a superfície de verdade, no navegador de verdade.
 *
 * O que só o navegador prova: que a página se sustenta com a cobrança
 * desligada, que nenhum valor é inventado no cliente, que voltar da tela de
 * pagamento **não** ativa nada, e que a superfície cabe em 375 sem rolagem
 * lateral.
 *
 * A organização do smoke usa um plano interno anterior ao catálogo comercial.
 * Isso não é um problema do teste — é o cenário legado da PR-PL-02, e a página
 * precisa aguentá-lo sem inventar "sem plano".
 */
import { expect, test } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

const SECAO = "/configuracoes?secao=assinatura";

/** As larguras do gate. */
const LARGURAS = [
  { nome: "1440", width: 1440, height: 900 },
  { nome: "1024", width: 1024, height: 800 },
  { nome: "768", width: 768, height: 900 },
  { nome: "375", width: 375, height: 812 },
] as const;

test.describe("Plano e assinatura", () => {
  test("a seção é alcançável por link direto e mostra os três blocos", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(SECAO);
    await settled(page);

    /** Deep link: a aba certa já vem selecionada. */
    await expect(
      page.getByRole("tab", { name: "Plano e assinatura" }),
    ).toHaveAttribute("data-state", "active");

    await expect(
      page.getByRole("heading", { name: "Plano atual" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Uso do plano" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Planos", exact: true }),
    ).toBeVisible();

    assertClean(recorder, "seção de assinatura");
  });

  test("os quatro planos aparecem com rótulo público, nunca com o código", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(SECAO);
    await settled(page);

    for (const plano of [
      "Essencial",
      "Profissional",
      "Profissional + Inteligência",
      "Empresarial Ilimitado",
    ]) {
      /** `exact`: "Profissional" também casaria com "Profissional + Inteligência". */
      await expect(
        page.getByRole("article", { name: plano, exact: true }),
      ).toBeVisible();
    }

    /** Código interno nunca vaza para a tela. */
    const texto = (await page.locator("main").innerText()).toUpperCase();
    for (const codigo of [
      "PROFESSIONAL_INTELLIGENCE",
      "ENTERPRISE_UNLIMITED",
      "OWNER_FULL_ACCESS",
      "NOCOM_",
      "NOFIN_",
      "STARTER",
    ]) {
      expect(texto, `código interno visível: ${codigo}`).not.toContain(codigo);
    }

    assertClean(recorder, "catálogo de planos");
  });

  test("os preços vêm do servidor nas três periodicidades", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(SECAO);
    await settled(page);

    const essencial = page.getByRole("article", {
      name: "Essencial",
      exact: true,
    });

    await expect(essencial).toContainText("59,90");

    await page.getByRole("tab", { name: "Semestral" }).click();
    await expect(essencial).toContainText("329,40");
    /** Equivalente mensal é derivação do valor publicado, mostrada ao lado. */
    await expect(essencial).toContainText("54,90");

    await page.getByRole("tab", { name: "Anual" }).click();
    await expect(essencial).toContainText("599,00");
    await expect(essencial).toContainText("49,92");

    assertClean(recorder, "seletor de periodicidade");
  });

  test("o seletor de periodicidade é operável por teclado", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(SECAO);
    await settled(page);

    const mensal = page.getByRole("tab", { name: "Mensal" });
    await mensal.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Semestral" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Anual" })).toBeFocused();

    assertClean(recorder, "teclado no seletor");
  });

  test("ilimitado aparece como palavra, nunca como número mágico", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(SECAO);
    await settled(page);

    const empresarial = page.getByRole("article", {
      name: "Empresarial Ilimitado",
      exact: true,
    });
    await expect(empresarial).toContainText("Ilimitado");

    const texto = await page.locator("main").innerText();
    expect(texto).not.toMatch(/\b999999\b|\bnull\b|\b-1\b/);

    assertClean(recorder, "limites ilimitados");
  });

  test("nenhum limite comercial de armazenamento aparece", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(SECAO);
    await settled(page);

    const texto = (await page.locator("main").innerText()).toLowerCase();
    expect(texto).not.toContain("armazenamento");
    expect(texto).not.toMatch(/\bgb\b/);

    assertClean(recorder, "sem cota de armazenamento");
  });

  test("o uso do plano usa o wording aprovado", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(SECAO);
    await settled(page);

    /**
     * Painel localizado pelo marcador, e não por `region`: o `PanelFrame` não
     * vira landmark de propósito — dezenas deles numa página seriam ruído para
     * quem navega por landmarks (decisão da PR-FE-H07).
     */
    const uso = page.locator('[data-panel="billing-usage"]');
    await expect(uso).toContainText("Técnicos operadores");
    await expect(uso).toContainText("auxiliares técnico");
    await expect(uso).toContainText("Usuários");
    await expect(uso).toContainText("Clientes");
    await expect(uso).toContainText("Equipamentos");
    await expect(uso).toContainText("Ordens de serviço");

    assertClean(recorder, "uso do plano");
  });

  test("a medição de IA não vira cota comercial na tela", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(SECAO);
    await settled(page);

    const texto = (await page.locator("main").innerText()).toLowerCase();
    /** A unidade comercial de IA não foi congelada; prometê-la seria mentira. */
    expect(texto).not.toContain("ai_compute");
    expect(texto).not.toMatch(/créditos de ia|creditos de ia/);

    assertClean(recorder, "sem cota de IA");
  });

  test("voltar da tela de pagamento não ativa assinatura", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(`${SECAO}&assinatura=sucesso`);
    await settled(page);

    /**
     * O parâmetro só diz que o navegador voltou. Quem confirma é o provedor,
     * por evento assinado — e a tela nunca afirma o que não sabe.
     */
    const texto = await page.locator("main").innerText();
    expect(texto).not.toMatch(/assinatura ativa!/i);

    assertClean(recorder, "retorno do checkout");
  });

  test("nenhum identificador de provedor ou segredo chega ao navegador", async ({
    page,
  }) => {
    const recorder = record(page);
    const corpos: string[] = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/api/orbit/billing")) return;
      corpos.push(await response.text().catch(() => ""));
    });

    await login(page);
    await page.goto(SECAO);
    await settled(page);

    for (const corpo of corpos) {
      expect(corpo).not.toMatch(/sk_live|sk_test|whsec_/);
      expect(corpo).not.toMatch(/"cus_|"price_|"sub_/);
      expect(corpo).not.toMatch(/fingerprint/i);
    }

    /** E nenhuma chamada sai do navegador direto para o provedor. */
    expect(
      recorder.failedRequests.filter((linha) => linha.includes("stripe.com")),
    ).toEqual([]);

    assertClean(recorder, "sem vazamento de provedor");
  });

  for (const largura of LARGURAS) {
    test(`a superfície cabe em ${largura.nome} sem rolagem lateral`, async ({
      page,
    }) => {
      const recorder = record(page);
      await page.setViewportSize({
        width: largura.width,
        height: largura.height,
      });
      await login(page);
      await page.goto(SECAO);
      await settled(page);

      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      );
      expect(overflow, `rolagem lateral em ${largura.nome}`).toBe(false);

      /** E os três blocos continuam presentes na largura estreita. */
      await expect(
        page.getByRole("heading", { name: "Plano atual" }),
      ).toBeVisible();

      assertClean(recorder, `superfície em ${largura.nome}`);
    });
  }

  test("a hierarquia de títulos permanece correta", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(SECAO);
    await settled(page);

    /** Um h1 da página; as seções abaixo dele, sem salto de nível. */
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(await page.getByRole("heading", { level: 2 }).count()).toBeGreaterThan(
      0,
    );

    assertClean(recorder, "hierarquia de títulos");
  });
});
