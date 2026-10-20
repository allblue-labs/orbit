/**
 * Gate de fechamento da PR-FE-H01.
 *
 * A PR trocou 220 textos. A pergunta que este arquivo responde é uma só:
 *
 * > a nova linguagem quebrou visualmente alguma tela?
 *
 * **Não** é uma auditoria do layout do Orbit. Margens largas, filtros
 * empilhados e densidade de página são dívidas conhecidas e pertencem à
 * PR-FE-H02 — reprovar aqui por causa delas transformaria o fechamento de uma
 * PR de copy numa PR de redesign.
 *
 * O que reprova aqui: conteúdo cortado sem saída, página rolando na
 * horizontal, e vocabulário de implementação de volta na tela.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

/** As larguras do gate. */
const WIDTHS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1024", width: 1024, height: 800 },
  { name: "768", width: 768, height: 900 },
] as const;

/** As superfícies principais da PR. */
const PAGES = [
  { name: "Dashboard", path: "/dashboard" },
  { name: "Agenda", path: "/agenda" },
  { name: "Operações", path: "/operacoes" },
  { name: "PMOC", path: "/pmoc" },
  { name: "RVT", path: "/rvt" },
  { name: "Documentos", path: "/documentos" },
  { name: "Modelos de documento", path: "/artefatos" },
  { name: "Clientes", path: "/clientes" },
  { name: "Produtos e Serviços", path: "/catalogo" },
  { name: "Orçamentos", path: "/orcamentos" },
  { name: "Equipe", path: "/equipe" },
  { name: "Financeiro", path: "/financeiro" },
  { name: "Perfil", path: "/perfil" },
  { name: "Organização", path: "/organizacao" },
  { name: "Configurações", path: "/configuracoes" },
] as const;

/**
 * Vocabulário que não pode voltar à tela.
 *
 * O guard estático olha o código; este olha o **texto renderizado**, que é onde
 * um valor vindo do servidor pode reintroduzir o que foi removido do código.
 */
const FORBIDDEN = [
  /\bback[- ]?end\b/i,
  /\bservidor(es)?\b/i,
  /\bread\s*models?\b/i,
  /\bendpoints?\b/i,
  /\bstate\s*machine\b/i,
  /\ballowedActions\b/,
  /\bblockedReasons?\b/,
  /\bsource(Type|Id)\b/,
  /\bsnapshots?\b/i,
  /\bpayloads?\b/i,
  /\bDTOs?\b/,
  /\brenderiza(ção|dor)\b/i,
  /\bHTTP\s*\d{3}\b/,
  /\bArtifact\s*Studio\b/i,
];

/**
 * Enums do **sistema** que não podem aparecer sem tradução.
 *
 * A lista é fechada de propósito. Um regex genérico de MAIÚSCULAS_COM_UNDERSCORE
 * reprovaria `ORBIT_PMOC` (chave de modelo escolhida pela organização),
 * `OWNER_FULL_ACCESS` (código de papel), `NOFIN_57827` (código de unidade) e
 * `HVAC_R` (segmento digitado no cadastro) — todos dados que pertencem a quem
 * os criou e são exibidos de propósito. Traduzi-los seria reescrever o dado do
 * cliente.
 *
 * O que se protege aqui é o outro caso: o estado de domínio que o servidor
 * publica e que a tela precisa apresentar em português.
 */
const SYSTEM_ENUMS = [
  "NOT_PREPARED",
  "IN_PROGRESS",
  "PENDING_UPLOAD",
  "CUSTOMER_VISIBLE",
  "FIELD_TECHNICIAN",
  "TECHNICAL_RESPONSIBLE",
  "ARTIFACT_MANIFESTS",
  "ARTIFACT_RENDERING",
  "ARTIFACT_TEMPLATES",
  "ARTIFACT_EXECUTIONS",
  "SOURCE_NOT_COMPLETED",
  "EVIDENCE_PENDING",
  "ACKNOWLEDGEMENT_STALE",
  "ACKNOWLEDGEMENT_REQUIRED",
  "TEMPLATE_NOT_AVAILABLE",
  "RT_SIGNATURE_MISSING",
  "VERSION_CONFLICT",
  "IDEMPOTENCY_MISMATCH",
  "RESOURCE_REMOVED",
  "AUTHORIZATION_CHANGED",
  "ASSIGNMENT_CHANGED",
  "SERVICE_OPERATION",
  "PMOC_EQUIPMENT_EXECUTION",
  "RVT_EXECUTION",
  "ONE_TIME",
  "SEMIANNUAL",
  "DUE_TODAY",
  "UNSCHEDULED",
];

/**
 * As frases que a H01 alongou.
 *
 * São o risco real de layout desta PR: 17 textos cresceram, o maior em 26
 * caracteres. Um corte que atinja uma delas é regressão **desta** PR; um corte
 * num título de evento vindo do banco é densidade de página, e pertence à
 * PR-FE-H02.
 */
const H01_COPY = [
  "Reservar material para um atendimento ainda não está disponível",
  "A busca considera todos os planos, não apenas esta página",
  "Não é possível excluir uma categoria em uso por lançamentos",
  "Único na organização: não é possível repetir um código já usado",
  "Estrutura versionada que dá origem às execuções em campo",
  "contratos ainda não são acompanhados no Orbit",
  "O que o seu acesso permite hoje",
  "O histórico de atividades existe por atendimento",
  "Chave do modelo, como aparece em Modelos de documento",
  "Criar organizações com o primeiro responsável",
  "Consultar usuários de todas as organizações",
  "A lista de documentos por cliente ainda não está disponível",
  "O lançamento é marcado como vencido depois desta data",
  "A busca considera toda a cobertura, não apenas esta página",
  "Não foi possível alterar a situação",
  "O documento foi solicitado e aguarda processamento",
  "Modelos de documento",
];

/** Conteúdo cortado sem forma de alcançá-lo. */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;

      const hiddenX =
        style.overflowX === "hidden" || style.overflow === "hidden";
      if (!hiddenX) continue;

      /**
       * `truncate` corta de propósito e mostra reticências — é decisão de
       * design, não defeito. Só interessa o que some sem aviso.
       */
      if (style.textOverflow === "ellipsis") continue;

      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow > 4 && el.clientWidth > 0) {
        const text = (el.textContent ?? "").trim().slice(0, 60);
        if (text)
          problems.push(`${el.tagName.toLowerCase()} +${overflow}px: ${text}`);
      }
    }
    return problems.slice(0, 8);
  });
}

/** A página inteira rolando na horizontal. */
async function scrollsSideways(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

/** Todo o texto visível da página. */
async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText ?? "");
}

test.describe("linguagem de produto — fechamento da H01", () => {
  for (const viewport of WIDTHS) {
    test.describe(`${viewport.name}px`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
      });

      test(`as superfícies principais sobrevivem à nova copy`, async ({
        page,
      }) => {
        /**
         * Quinze superfícies numa volta só, cada uma varrida elemento a
         * elemento. Cada página abre em menos de dois segundos; é a soma que
         * passa dos 60 segundos padrão, e ela cresce a cada tela nova do
         * produto — a de Perfil ganhou foto e assinatura nesta PR.
         */
        test.setTimeout(180_000);

        const recorder = record(page);
        await login(page);

        const failures: string[] = [];
        /** Cortes que não vêm desta PR — reportados, não reprovados. */
        const debt: string[] = [];

        for (const surface of PAGES) {
          await page.goto(surface.path);
          await settled(page);

          const sideways = await scrollsSideways(page);
          if (sideways > 2) {
            failures.push(
              `${surface.name}: página rola ${sideways}px na horizontal`,
            );
          }

          /**
           * Corte que atinge copy da H01 reprova; o resto é registrado como
           * dívida de layout e segue para a H02. A pergunta desta suíte é se a
           * **nova linguagem** quebrou a tela, não se a densidade da página é
           * ideal.
           */
          for (const cut of await clipped(page)) {
            const fromH01 = H01_COPY.some((phrase) => cut.includes(phrase));
            if (fromH01) {
              failures.push(`${surface.name}: copy da H01 cortada — ${cut}`);
            } else {
              debt.push(`${surface.name}: ${cut}`);
            }
          }

          const text = await visibleText(page);
          for (const pattern of FORBIDDEN) {
            const hit = text.match(pattern);
            if (hit)
              failures.push(
                `${surface.name}: termo técnico "${hit[0]}" na tela`,
              );
          }

          /** Estado de domínio que chegou à tela sem tradução. */
          for (const value of SYSTEM_ENUMS) {
            if (new RegExp(`\\b${value}\\b`).test(text)) {
              failures.push(`${surface.name}: estado cru "${value}" na tela`);
            }
          }
        }

        if (debt.length) {
          console.info(
            `[${viewport.name}px] dívida de layout preexistente (H02):\n  ` +
              debt.join("\n  "),
          );
        }
        expect(failures, `problemas em ${viewport.name}px`).toEqual([]);
        assertClean(recorder, `navegação em ${viewport.name}px`);
      });
    });
  }
});

test.describe("Modelos de documento", () => {
  /**
   * O que este teste ainda prova, e o que deixou de ter objeto.
   *
   * Ele nasceu quando "Artefatos" virou "Modelos de documento" no menu, e media
   * três coisas: que o rótulo longo caberia na sidebar, que o item levaria à
   * tela certa, e que a tela não vazaria "Artifact Studio" — o nome interno do
   * módulo.
   *
   * O rótulo **saiu da sidebar**: modelos virou aba de Relatórios, e a aba se
   * chama "Modelos". Não há mais rótulo de 20 caracteres para truncar, então
   * aquela parte perdeu o objeto — medir truncamento de um texto que não existe
   * não é cobertura, é ruído.
   *
   * O resto vale mais do que antes: agora há um caminho a mais para errar.
   */
  test("a aba leva à tela certa, sem vazar o nome interno do módulo", async ({
    page,
  }) => {
    await login(page);

    /* Pela rota antiga, que é o que alguém tem guardado. */
    await page.goto("/artefatos");
    await settled(page);

    /* `goto` já seguiu o redirecionamento; esperar por outra navegação esperaria
       para sempre. O que se afirma é onde a pessoa chegou. */
    const url = new URL(page.url());
    expect(url.pathname).toBe("/relatorios");
    expect(url.searchParams.get("secao")).toBe("modelos");

    const aba = page.getByRole("tab", { name: "Modelos", exact: true });
    await expect(aba).toHaveAttribute("aria-selected", "true");

    /* O conteúdo é o que era: a lista dos modelos que a operação emite. */
    await expect(
      page.getByText(/Abra um para ver como o documento sai/i),
    ).toBeVisible();

    /** "Artifact Studio" é o nome do módulo, não do produto. */
    const text = await visibleText(page);
    expect(text).not.toContain("Artifact Studio");
  });
});
