/**
 * CEP preenche o endereço.
 *
 * O que se prova: que digitar o CEP traz rua, bairro, cidade e estado; que os
 * campos continuam editáveis depois; que número e complemento não são tocados;
 * e que CEP inexistente ou serviço fora do ar avisam sem travar o cadastro.
 */
import { expect, test, type Page } from "@playwright/test";

import { assertClean, login, record, type Recorder } from "./support";

/**
 * A verificação para os cenários que provocam recusa de propósito.
 *
 * `assertClean` reprova qualquer `console.error`, e o Chromium escreve um
 * quando a resposta não é 2xx. Nestes testes o 404 é o que se está provando.
 * O resto continua valendo: exceção não tratada e aviso de React seguem sendo
 * defeito.
 */
function assertHandled(recorder: Recorder, where: string): void {
  expect(recorder.pageErrors, `exceções não tratadas em ${where}`).toEqual([]);
  expect(recorder.reactWarnings, `avisos de React em ${where}`).toEqual([]);
  const inesperados = recorder.consoleErrors.filter(
    (mensagem) => !/Failed to load resource|ERR_FAILED/.test(mensagem),
  );
  expect(inesperados, `console.error inesperado em ${where}`).toEqual([]);
}

/** Um CEP real, de endereço estável. */
const CEP = "50030230";
const RUA = "Cais do Apolo";

async function abrirFormulario(page: Page) {
  await page.goto("/clientes");
  await page.getByRole("button", { name: "Novo cliente" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test("o CEP preenche o endereço do cliente", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await abrirFormulario(page);

  await page.getByLabel("CEP").fill(CEP);

  await expect(page.getByLabel("Logradouro")).toHaveValue(RUA, {
    timeout: 20_000,
  });
  await expect(page.getByLabel("Bairro")).toHaveValue("Recife");
  await expect(page.getByLabel("Cidade")).toHaveValue("Recife");
  await expect(page.getByLabel("UF")).toHaveValue("PE");
  await expect(page.getByLabel("Estado")).toHaveValue("Pernambuco");
  /** O campo mostra o CEP formatado. */
  await expect(page.getByLabel("CEP")).toHaveValue("50030-230");

  assertClean(recorder, "preenchimento por CEP");
});

test("número e complemento continuam de quem preenche", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await abrirFormulario(page);

  await page.getByLabel("Número", { exact: true }).fill("1200");
  await page.getByLabel("Complemento").fill("Sala 5");
  await page.getByLabel("CEP").fill(CEP);
  await expect(page.getByLabel("Logradouro")).toHaveValue(RUA, {
    timeout: 20_000,
  });

  /** O CEP conhece a rua, não a porta. */
  await expect(page.getByLabel("Número", { exact: true })).toHaveValue("1200");
  await expect(page.getByLabel("Complemento")).toHaveValue("Sala 5");

  assertClean(recorder, "número preservado");
});

test("o que veio do CEP continua editável", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await abrirFormulario(page);

  await page.getByLabel("CEP").fill(CEP);
  await expect(page.getByLabel("Logradouro")).toHaveValue(RUA, {
    timeout: 20_000,
  });

  /** A consulta é conveniência, não autoridade: dá para corrigir. */
  await page.getByLabel("Logradouro").fill("Cais do Apolo, anexo");
  await expect(page.getByLabel("Logradouro")).toHaveValue("Cais do Apolo, anexo");

  assertClean(recorder, "endereço editável");
});

test("CEP inexistente avisa e não trava o cadastro", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await abrirFormulario(page);

  await page.getByLabel("CEP").fill("99999999");

  const aviso = page.getByRole("status").filter({ hasText: /CEP não encontrado/i });
  await expect(aviso).toBeVisible({ timeout: 20_000 });
  /** Fala com quem digitou, não do transporte. */
  await expect(aviso).not.toContainText(/404|erro|falha técnica/i);

  /** E o cadastro segue possível preenchendo à mão. */
  await page.getByLabel("Cidade").fill("Olinda");
  await expect(page.getByLabel("Cidade")).toHaveValue("Olinda");
  await expect(
    page.getByRole("button", { name: "Cadastrar cliente" }),
  ).toBeEnabled();

  assertHandled(recorder, "CEP inexistente");
});

test("serviço fora do ar não impede o cadastro", async ({ page }) => {
  const recorder = record(page);
  await login(page);

  /** A indisponibilidade é do terceiro; o formulário continua de pé. */
  await page.route("**/api/cep/**", (route) => route.abort("failed"));

  await abrirFormulario(page);
  await page.getByLabel("CEP").fill(CEP);

  await expect(page.getByLabel("Cidade")).toHaveValue("");
  await page.getByLabel("Cidade").fill("Recife");
  await expect(
    page.getByRole("button", { name: "Cadastrar cliente" }),
  ).toBeEnabled();

  assertHandled(recorder, "serviço indisponível");
});

test("o cadastro de organização também preenche pelo CEP", async ({ page }) => {
  const recorder = record(page);
  await page.goto("/cadastro");

  const continuar = page.getByRole("button", { name: "Continuar" });
  const sufixo = crypto.randomUUID().replace(/-/g, "").slice(0, 8);

  /**
   * O cenário percorre o formulário até o passo do endereço e **não envia**:
   * o que se prova é o preenchimento, e submeter criaria uma organização nova
   * no tenant a cada execução.
   */
  /*
    "Essencial", e não "Starter".

    O passo de plano lia `GET /plans` — a tabela inteira, com os planos que as
    suítes de direitos criam e os internos. O `STARTER` estava entre eles, a
    R$ 0,00 e rotulado "Gratuito". Agora a tela lê o catálogo comercial, que
    tem os quatro planos de verdade.
  */
  await page.getByRole("button", { name: /^Essencial/ }).click();
  await continuar.click();

  await page.getByLabel("Nome", { exact: true }).fill("Ana");
  await page.getByLabel("Sobrenome").fill("Teste");
  await page.getByLabel("E-mail corporativo").fill(`cep.${sufixo}@exemplo.com.br`);
  const senhas = page.locator('input[type="password"]');
  await senhas.nth(0).fill("SenhaForte@2026");
  await senhas.nth(1).fill("SenhaForte@2026");
  await continuar.click();

  await page.getByLabel("Nome da organização").fill(`Cenário CEP ${sufixo}`);
  await page.getByLabel("Razão social").fill(`Cenário CEP ${sufixo} LTDA`);
  await page.getByLabel("CPF ou CNPJ").fill("11222333000181");
  await continuar.click();

  /** Passo do endereço da matriz — onde o CEP entra. */
  const cep = page.getByLabel("CEP");
  await expect(cep).toBeVisible({ timeout: 20_000 });
  await cep.fill(CEP);

  /** Pelos identificadores: "Cidade" e "UF" aparecem mais de uma vez na página. */
  await expect(page.locator("#city")).toHaveValue("Recife", { timeout: 20_000 });
  await expect(page.locator("#stateCode")).toHaveValue("PE");
  await expect(page.locator("#street")).toHaveValue(RUA);

  assertClean(recorder, "cadastro de organização");
});
