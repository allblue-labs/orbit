/**
 * Assinatura vencida: o aviso, o selo e o caminho para resolver.
 *
 * ## Por que a sessão é interceptada
 *
 * O estado que interessa — assinatura fora do período — nasce do relógio, e
 * não há comando de API que o produza: seria preciso envelhecer a organização
 * no banco, que a suíte do frontend não alcança. Interceptar
 * `/api/auth/session` entrega exatamente o contrato que o `SessionProvider`
 * consome, sem inventar nada sobre o resto da aplicação.
 *
 * O que o backend faz com o vencimento — servir leitura, recusar escrita com
 * `402` — é provado contra o servidor real em
 * `backend/test/subscription-expiry.e2e-spec.ts`.
 */
import { expect, test, type Page } from "@playwright/test";

import { login, settled } from "./support";

const AVISO = "Sua avaliação gratuita terminou";

/**
 * Faz a sessão desta página reportar a assinatura como vencida.
 *
 * Só o par que decide é trocado (`subscriptionActive` e a data); todo o resto
 * da sessão continua sendo o que o servidor respondeu, para que a tela não
 * passe a depender de um duplo inteiro.
 */
async function comAssinaturaVencida(page: Page): Promise<void> {
  await page.route("**/api/auth/session", async (route) => {
    /*
      `sec-fetch-*` é cabeçalho controlado pelo navegador: o replay do
      Playwright não o reenvia, e o BFF — que recusa o que não é mesma origem —
      responde 403. Repô-lo explicitamente é o que faz o replay valer o mesmo
      que a requisição original.
    */
    const resposta = await route.fetch({
      headers: {
        ...route.request().headers(),
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "cors",
      },
    });
    const corpo = (await resposta.json()) as {
      data?: Record<string, unknown>;
    } & Record<string, unknown>;
    /* O BFF devolve envelopado; a sessão mora em `data`. */
    const sessao = corpo.data ?? corpo;
    /*
      Sem reaproveitar a resposta original: os cabeçalhos dela trazem o
      `content-length` do corpo antigo, e o corpo novo chega truncado — a
      interceptação parece não ter efeito.
    */
    await route.fulfill({
      status: resposta.status(),
      contentType: "application/json",
      body: JSON.stringify({
        ...corpo,
        data: {
          ...sessao,
          subscriptionActive: false,
          subscriptionEndsAt: "2026-09-13T21:43:35.460Z",
        },
      }),
    });
  });
}

test("o aviso aparece uma vez e não volta ao navegar", async ({ page }) => {
  await login(page);
  await comAssinaturaVencida(page);
  await page.goto("/dashboard");
  await settled(page);

  await expect(page.getByText(AVISO)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Agora não" }).click();
  await expect(page.getByText(AVISO)).toHaveCount(0);

  /**
   * A regressão que este teste tranca.
   *
   * O aviso morava dentro do `AppShell`, que é montado **por página** e
   * remonta a cada navegação. Dispensá-lo valia até o primeiro clique no menu:
   * o componente nascia de novo e reabria. Recarregar a página funcionava
   * (o cookie era lido no servidor), navegar não — o contrário do que se
   * esperaria, e por isso passou despercebido.
   */
  for (const destino of ["Clientes", "Agenda"]) {
    await page.getByRole("link", { name: destino }).first().click();
    await page.waitForURL(new RegExp(destino === "Clientes" ? "clientes" : "agenda"), {
      timeout: 20_000,
    });
    await settled(page);
    await expect(
      page.getByText(AVISO),
      `o aviso voltou ao navegar para ${destino}`,
    ).toHaveCount(0);
  }

  /** E nem num carregamento completo: o cookie cobre as próximas 12 horas. */
  await page.goto("/documentos");
  await settled(page);
  await expect(page.getByText(AVISO)).toHaveCount(0);
});

test("o selo fica, e leva para onde se contrata um plano", async ({ page }) => {
  await login(page);
  await comAssinaturaVencida(page);
  await page.goto("/dashboard");
  await settled(page);

  await page.getByRole("button", { name: "Agora não" }).click();

  /** Dispensado o aviso, o selo é o que resta contando o estado. */
  const selo = page.getByRole("link", { name: /Assinatura vencida/ });
  await expect(selo).toBeVisible();
  await selo.click();

  await page.waitForURL(/configuracoes\?secao=assinatura/, { timeout: 20_000 });
  await settled(page);

  /**
   * A página de destino precisa concordar com o selo.
   *
   * Ela dizia "O acesso atual continua valendo" enquanto a topbar dizia
   * vencida e o servidor recusava toda escrita: a janela mostrada ali é
   * calculada pelo módulo de cobrança e não é o período que o guarda confere.
   * Quem clica no aviso chega aqui para resolver — e encontrava a negação do
   * problema.
   */
  await expect(page.getByText("O período de acesso terminou")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/continua valendo/)).toHaveCount(0);

  /** E os planos estão à vista, que é a razão de ter vindo. */
  for (const plano of ["Essencial", "Profissional", "Empresarial Ilimitado"]) {
    await expect(
      page.getByRole("heading", { name: plano, exact: true }).first(),
    ).toBeVisible();
  }
});
