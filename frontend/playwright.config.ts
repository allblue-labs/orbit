/**
 * Smoke de navegador — o gate de fechamento da PR-FE-01.
 *
 * ## Por que existe, e por que é pequeno
 *
 * Smoke por HTTP prova que a rota responde 200. Não prova hydration, foco,
 * teclado, viewport nem erro de console — e foi exatamente isso que manteve a
 * PR aberta. Este projeto cobre as jornadas críticas e nada além: login,
 * navegação principal, autoridade do servidor na interface, estados de erro.
 *
 * Sem golden screenshots. Um Chromium basta para o fechamento; matriz de
 * navegadores é outra conversa e não muda o que está sendo verificado aqui.
 *
 * O servidor **não** é iniciado por aqui: os testes rodam contra a pilha real
 * já no ar — Next em produção, NestJS sob o papel restrito `orbit_app`, RLS
 * ativa. Subir um servidor de teste esconderia justamente o que se quer ver.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  /** Serial: a suíte compartilha uma organização real e um banco real. */
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",

  use: {
    baseURL: process.env.ORBIT_WEB_URL ?? "http://127.0.0.1:3000",
    locale: "pt-BR",
    /**
     * Fuso deliberadamente diferente do da unidade de negócio.
     *
     * A unidade é `America/Recife`; o navegador diz Lisboa. Se alguma data
     * civil for reinterpretada pelo relógio do cliente, aparece aqui.
     */
    timezoneId: "Europe/Lisbon",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
