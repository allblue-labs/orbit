/**
 * Cadastro de cliente — jornada real.
 *
 * Roda contra o backend de verdade: sessão por cookie HttpOnly, BFF, papel
 * restrito no Postgres e RLS. Nada aqui é simulado.
 *
 * ## Dados de teste
 *
 * Cada cenário fabrica o seu próprio cliente, com razão social e documento
 * únicos. Nenhum teste procura "o primeiro que casar" numa base compartilhada
 * — foi essa a lição do harness do Mobile. Os registros ficam: `DELETE` existe
 * no contrato, mas apagar por SQL o que a aplicação criou seria falsear o
 * estado do tenant.
 */
import { expect, test, type Page, type Request } from "@playwright/test";

import { assertClean, login, record, type Recorder } from "./support";

/**
 * A verificação para os cenários que provocam recusa de propósito.
 *
 * `assertClean` reprova qualquer `console.error`, e o Chromium escreve um
 * quando uma resposta não é 2xx — "Failed to load resource… 400". Nesses dois
 * testes o 4xx é o que se está a provar. O que continua a valer é o resto:
 * exceção não tratada e aviso de React seguem sendo defeito.
 */
function assertHandled(recorder: Recorder, where: string): void {
  expect(recorder.pageErrors, `exceções não tratadas em ${where}`).toEqual([]);
  expect(recorder.reactWarnings, `avisos de React em ${where}`).toEqual([]);
  const unexpected = recorder.consoleErrors.filter(
    (message) => !/Failed to load resource/.test(message),
  );
  expect(unexpected, `console.error inesperado em ${where}`).toEqual([]);
}

/** Sufixo por execução, para que dois runs não disputem o mesmo nome. */
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let sequence = 0;
const uniqueName = (label: string) =>
  `Teste H03 ${label} ${RUN}-${(sequence += 1)}`;

/**
 * Um CNPJ com dígitos verificadores corretos.
 *
 * O backend valida o cálculo (`IsDocument`), então o número precisa fechar.
 * Isto é geração de formato, não de dado falso: o cliente criado é real.
 */
function generateCnpj(): string {
  const base = Array.from({ length: 12 }, () =>
    Math.floor(Math.random() * 10),
  );
  const digit = (digits: number[]) => {
    const weights =
      digits.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = digits.reduce((total, d, i) => total + d * weights[i], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const first = digit(base);
  const second = digit([...base, first]);
  return [...base, first, second].join("");
}

async function openForm(page: Page) {
  await page.goto("/clientes");
  await page.getByRole("button", { name: "Novo cliente" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

const legalNameField = (page: Page) =>
  page.getByLabel(/Razão social ou nome/i);

/** Captura os corpos enviados a `POST /customers`. */
function watchCreates(page: Page): { bodies: unknown[] } {
  const bodies: unknown[] = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "POST") return;
    if (!/\/customers(\?|$)/.test(new URL(request.url()).pathname)) return;
    try {
      bodies.push(JSON.parse(request.postData() ?? "null"));
    } catch {
      bodies.push(request.postData());
    }
  });
  return { bodies };
}

test.describe("cadastro de cliente", () => {
  test("a listagem oferece a ação de cadastrar a quem pode", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto("/clientes");

    const cta = page.getByRole("button", { name: "Novo cliente" });
    await expect(cta).toBeVisible();
    /** A CTA é da área de ação da listagem, não dos filtros. */
    await expect(
      page.locator("form, [class*=grid]").filter({ has: cta }),
    ).toHaveCount(0);

    assertClean(recorder, "listagem de clientes");
  });

  test("cadastro mínimo cria e leva à ficha do cliente", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    const name = uniqueName("Mínimo");

    await openForm(page);
    await legalNameField(page).fill(name);
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();

    /** O redirecionamento usa o id que o servidor publicou. */
    await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name })).toBeVisible();

    assertClean(recorder, "cadastro mínimo");
  });

  test("cadastro completo envia só o que o contrato aceita", async ({ page }) => {
    const recorder = record(page);
    const seen = watchCreates(page);
    await login(page);

    const name = uniqueName("Completo");
    const cnpj = generateCnpj();

    await openForm(page);
    await legalNameField(page).fill(name);
    await page.getByLabel(/Nome fantasia/i).fill("Clima Norte");
    await page.getByLabel("Tipo de documento").click();
    await page.getByRole("option", { name: "CNPJ" }).click();
    await page.getByLabel(/Número do documento/i).fill(cnpj);
    await page.getByLabel("E-mail").fill(`h03.${RUN}@exemplo.com.br`);
    await page.getByLabel("Telefone").fill("81 3333-4444");
    await page.getByLabel("Cidade").fill("Recife");
    await page.getByLabel("UF").fill("PE");
    await page.getByLabel("Observações").fill("Cadastro do smoke da PR-FE-H03.");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();

    await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Clima Norte" })).toBeVisible();

    const body = seen.bodies.at(-1) as Record<string, unknown>;
    /** Documento em dígitos: a máscara é da tela. */
    expect(body.documentNumber).toBe(cnpj);
    expect(body.address).toEqual({ city: "Recife", stateCode: "PE" });
    /** Nenhum campo de tenant viaja no corpo — a organização vem do token. */
    for (const key of Object.keys(body)) {
      expect(key).not.toMatch(/organization|tenant|businessUnit/i);
    }

    assertClean(recorder, "cadastro completo");
  });

  test("razão social vazia não vira requisição", async ({ page }) => {
    const recorder = record(page);
    const seen = watchCreates(page);
    await login(page);

    await openForm(page);
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();

    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(seen.bodies).toEqual([]);
    /** O diálogo continua aberto, com o que foi digitado. */
    await expect(page.getByRole("dialog")).toBeVisible();

    assertClean(recorder, "validação obrigatória");
  });

  test("o servidor é a autoridade final sobre o formato do e-mail", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);

    await openForm(page);
    await legalNameField(page).fill(uniqueName("E-mail"));
    /** A tela aceita; o `IsEmail` do contrato recusa. */
    await page.getByLabel("E-mail").fill("contato@exemplo..com");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();

    const dialog = page.getByRole("dialog");
    const alert = dialog.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });

    /**
     * A recusa é do servidor, e a frase é do produto.
     *
     * O contrato público de erros (PR-35) devolve `VALIDATION_ERROR` com copy
     * PT-BR determinística para o que o `ValidationPipe` recusa — de propósito
     * sem citar o campo, para não publicar o vocabulário do DTO. Antes o
     * backend respondia "email must be an email" e o Web traduzia por regex;
     * essas traduções foram removidas junto, porque a origem passou a falar a
     * língua do produto.
     *
     * O que se afirma aqui é o invariante, não a frase do catálogo: a tela
     * mostra texto em português e nenhum termo de contrato escapa.
     */
    const texto = (await alert.innerText()).trim();
    expect(texto.length).toBeGreaterThan(0);
    expect(texto).not.toMatch(/must be|should not|isEmail|property |constraint/i);
    /** Acentuação é a prova barata de que a frase é a de produto, não a do validador. */
    expect(texto).toMatch(/[À-úçÇ]/);

    /** E a recusa mantém o formulário aberto, com o que foi digitado. */
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("E-mail")).toHaveValue("contato@exemplo..com");

    assertHandled(recorder, "validação do servidor");
  });

  test("documento repetido volta como conflito, em linguagem de produto", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);

    const cnpj = generateCnpj();

    await openForm(page);
    await legalNameField(page).fill(uniqueName("Original"));
    await page.getByLabel("Tipo de documento").click();
    await page.getByRole("option", { name: "CNPJ" }).click();
    await page.getByLabel(/Número do documento/i).fill(cnpj);
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await openForm(page);
    await legalNameField(page).fill(uniqueName("Repetido"));
    await page.getByLabel("Tipo de documento").click();
    await page.getByRole("option", { name: "CNPJ" }).click();
    await page.getByLabel(/Número do documento/i).fill(cnpj);
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();

    const dialog = page.getByRole("dialog");
    const alert = dialog.getByRole("alert");
    await expect(alert).toBeVisible({ timeout: 15_000 });
    /** Fala de negócio, em português, sem vocabulário de banco nem do contrato. */
    await expect(alert).toContainText(/já existe um cliente cadastrado/i);
    const message = (await alert.innerText()).toLowerCase();
    expect(message).not.toMatch(
      /constraint|unique|p2002|prisma|violation|customer|document|registered/,
    );
    await expect(dialog).toBeVisible();

    assertHandled(recorder, "documento repetido");
  });

  test("dois cliques criam um cliente só", async ({ page }) => {
    const recorder = record(page);
    const seen = watchCreates(page);
    await login(page);

    await openForm(page);
    await legalNameField(page).fill(uniqueName("Duplo clique"));

    /**
     * Dois disparos no mesmo tick — o pior caso. Esperar entre os cliques
     * deixaria o React desabilitar o botão e o teste provaria menos do que diz.
     */
    await page.evaluate(() => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes("Cadastrar cliente"),
      );
      button?.click();
      button?.click();
    });

    await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/, { timeout: 20_000 });
    expect(seen.bodies).toHaveLength(1);

    assertClean(recorder, "duplo clique");
  });

  test("cancelar não cadastra nada", async ({ page }) => {
    const recorder = record(page);
    const seen = watchCreates(page);
    await login(page);

    const name = uniqueName("Cancelado");
    await openForm(page);
    await legalNameField(page).fill(name);
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(seen.bodies).toEqual([]);

    /** Reabrir começa em branco: o formulário não guarda o que foi abandonado. */
    await page.getByRole("button", { name: "Novo cliente" }).click();
    await expect(legalNameField(page)).toHaveValue("");

    assertClean(recorder, "cancelamento");
  });

  test("o cliente novo aparece na listagem sem recarregar a página", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);

    const name = uniqueName("Busca");
    await openForm(page);
    await legalNameField(page).fill(name);
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    /** Volta pela navegação do produto, sem recarga do documento. */
    await page.getByRole("link", { name: "Clientes" }).first().click();
    await page.waitForURL(/\/clientes$/);
    await page.getByLabel("Buscar").fill(name);
    await expect(
      page.getByRole("link", { name, exact: true }),
    ).toBeVisible({ timeout: 20_000 });

    assertClean(recorder, "listagem depois do cadastro");
  });

  test("a ficha do cliente oferece a edição, que grava o que o servidor confirma", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);

    const name = uniqueName("Edição");
    await openForm(page);
    await legalNameField(page).fill(name);
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await page.waitForURL(/\/clientes\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    await page.getByRole("button", { name: "Editar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    /** A edição parte do que está gravado. */
    await expect(legalNameField(page)).toHaveValue(name);

    await page.getByLabel(/Nome fantasia/i).fill("Nome de vitrine");
    await dialog.getByRole("button", { name: "Salvar" }).click();

    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Nome de vitrine" }),
    ).toBeVisible();

    assertClean(recorder, "edição do cliente");
  });

  test("o formulário é operável pelo teclado e explica a recusa a quem não vê", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);
    await openForm(page);

    const dialog = page.getByRole("dialog");

    /** Todo campo tem rótulo próprio — nenhum depende de placeholder. */
    const orphanLabels = await dialog.evaluate((node) =>
      Array.from(node.querySelectorAll("label")).filter((label) => {
        const target = label.getAttribute("for");
        return !target || !node.querySelector(`#${CSS.escape(target)}`);
      }).length,
    );
    expect(orphanLabels).toBe(0);

    /** Obrigatório dito por escrito, não só por cor. */
    await expect(
      dialog.getByText(/Razão social ou nome \(obrigatório\)/),
    ).toBeVisible();

    /** A recusa é anunciada junto do campo, não solta na tela. */
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    const field = page.getByLabel(/Razão social ou nome/i);
    await expect(field).toHaveAttribute("aria-invalid", "true");
    const describedBy = await field.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(dialog.locator(`#${describedBy}`)).toBeVisible();
    /** E o foco vai para ele, para quem navega sem ponteiro. */
    await expect(field).toBeFocused();

    /** O contorno prende o foco no diálogo. */
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        document.querySelector('[role="dialog"]')?.contains(document.activeElement),
      ),
    ).toBe(true);

    /** Escape fecha, como em qualquer diálogo do produto. */
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    assertClean(recorder, "acessibilidade do formulário");
  });
});
