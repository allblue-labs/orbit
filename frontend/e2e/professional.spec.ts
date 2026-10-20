/**
 * Papéis profissionais e equipe do atendimento, em navegador real.
 *
 * O cenário no banco cobre os cinco casos que importam:
 *
 * ```
 * Ana    → Técnico em Campo
 * Bruno  → Responsável Técnico
 * Carla  → os dois
 * Diego  → nenhum papel profissional
 * Elena  → perfil inativo
 * ```
 *
 * O que se prova não é a regra — quem decide quem é elegível é o servidor —,
 * mas que a tela **respeita** a decisão dele: cada seletor mostra o elenco do
 * seu papel, quem não tem papel não aparece, e nenhum código de contrato
 * chega ao usuário.
 *
 * A aba Profissionais saiu da tela de Equipe; o perfil profissional continua
 * no detalhe de cada membro, e é por lá que estes testes o alcançam.
 */
import { expect, test } from "@playwright/test";
import { provisionOperation, provisionOperationWithTeam } from "./provision";
import { assertClean, login, record, settled } from "./support";

test("o detalhe do membro separa ofício de acesso", async ({ page }) => {
  const recorder = record(page);
  await login(page);
  await page.goto("/equipe");
  await settled(page);

  /**
   * Pelo detalhe da pessoa, e não mais por uma aba própria.
   *
   * A aba Profissionais saiu da tela de Equipe. O que ela mostrava — ofício,
   * credencial e assinatura — continua inteiro em "Perfil profissional",
   * dentro de cada membro; o que se perdeu foi a visão de elenco, não o dado.
   *
   * A garantia que este teste protege é a mesma de antes: **ofício e acesso são
   * coisas diferentes**, e a tela nunca deduz um a partir do outro.
   */
  await page.getByRole("button", { name: "Ana Campo" }).first().click();

  /**
   * Espera o **conteúdo**, não o título da seção.
   *
   * O cabeçalho "Perfil profissional" aparece junto do esqueleto, então
   * esperá-lo e ler o texto em seguida media a tela ainda carregando — a
   * asserção reprovava por corrida, não por defeito.
   */
  await expect(
    page.getByText("Técnico em Campo").first(),
  ).toBeVisible({ timeout: 20_000 });

  /// Acesso é a outra leitura, e aparece separada na mesma folha.
  await expect(
    page.getByText("Papel e permissões efetivas"),
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await settled(page);

  /**
   * Quem não tem papel profissional é o caso comum, não um erro.
   *
   * Diego é do escritório: tem acesso ao sistema e nenhum ofício de campo. A
   * folha precisa dizer isso com todas as letras, senão a ausência parece
   * falha de carregamento.
   */
  await page.getByRole("button", { name: "Diego Escritorio" }).first().click();
  await expect(
    page.getByText(/não possui perfil profissional/i),
  ).toBeVisible({ timeout: 20_000 });

  /**
   * Gate parcial, pelo mesmo motivo de "plano inexistente é ausência neutra".
   *
   * Quem não tem perfil profissional faz o servidor responder **404**, e o
   * navegador registra isso como erro de console. É o contrato: ausência de
   * perfil é 404, e a tela o traduz em texto. Exigir console limpo aqui
   * reprovaria o comportamento correto.
   *
   * Exceção e aviso de React continuam valendo — esses nunca são esperados.
   */
  expect(recorder.pageErrors, "exceções não tratadas").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React").toEqual([]);
});

test("o seletor de Técnico em Campo não oferece quem só é Responsável Técnico", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  /**
   * O cenário abre a operação que ele mesmo criou.
   *
   * Antes clicava na primeira `OS-` da listagem: com 225 operações no tenant,
   * a primeira página virou toda de visitas avulsas de outros testes e o link
   * deixou de existir. Uma operação própria não depende de ordenação nem de
   * quantos registros existem.
   */
  const operation = await provisionOperation(page, "papeis");
  await page.goto(`/operacoes/${operation.id}`);
  await settled(page);

  /**
   * O painel de equipe vive no detalhe, não atrás de um modal.
   *
   * O título do painel e o rótulo interno se chamam ambos "Equipe" desde que
   * os painéis passaram a ter cabeçalho de verdade; o que interessa aqui é que
   * a seção esteja na página.
   */
  await expect(
    page.getByRole("heading", { name: "Equipe" }).first(),
  ).toBeVisible();

  const trigger = page
    .getByRole("button", { name: /Definir responsável|Trocar/ })
    .first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  const names = (await options.allInnerTexts()).join("|");

  /**
   * O que importa é a separação de papéis, não quem sobrou.
   *
   * Ana e Carla têm o papel de campo, mas quem já está na equipe deste
   * atendimento é omitido do seletor — então afirmar as duas dependeria da
   * ordem dos testes. O invariante é o outro lado: quem **não** tem o papel
   * nunca aparece, aconteça o que acontecer antes.
   */
  expect(names).toMatch(/Ana Campo|Carla Dupla/);
  expect(names).not.toContain("Bruno Responsavel");
  expect(names).not.toContain("Diego Escritorio");
  expect(names).not.toContain("Elena Inativa");

  await page.keyboard.press("Escape");
  assertClean(recorder, "seletor de campo");
});

test("definir responsável e adicionar auxiliares usa os comandos reais", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  const operation = await provisionOperation(page, "equipe");
  await page.goto(`/operacoes/${operation.id}`);
  await settled(page);

  const team = page.getByRole("region", { name: "Equipe" });

  /** 1 · define ou troca o responsável */
  await page
    .getByRole("button", { name: /Definir responsável|Trocar/ })
    .first()
    .click();
  await page.getByRole("option", { name: /Ana Campo/ }).click();
  await expect(team.getByText("Ana Campo")).toBeVisible({ timeout: 20_000 });

  /** 2 · adiciona um auxiliar */
  await team.getByRole("button", { name: /Adicionar/ }).click();
  await page.getByRole("option", { name: /Carla Dupla/ }).click();
  await expect(team.getByText("Carla Dupla")).toBeVisible({ timeout: 20_000 });

  /**
   * 3 · quem já está na equipe não é oferecido de novo.
   *
   * O servidor recusaria a duplicidade de qualquer forma; a tela evita
   * oferecer o que ele recusaria.
   */
  await team.getByRole("button", { name: /Adicionar/ }).click();
  const remaining = (await page.getByRole("option").allInnerTexts()).join("|");
  expect(remaining).not.toContain("Ana Campo");
  expect(remaining).not.toContain("Carla Dupla");
  await page.keyboard.press("Escape");

  assertClean(recorder, "gestão de equipe");
});

test("promover um auxiliar troca o responsável em um comando", async ({
  page,
}) => {
  const recorder = record(page);
  await login(page);
  /** A equipe é montada pelo cenário: um responsável e um auxiliar a promover. */
  const operation = await provisionOperationWithTeam(page, "promover");
  await page.goto(`/operacoes/${operation.id}`);
  await settled(page);

  const team = page.getByRole("region", { name: "Equipe" });
  await expect(team.getByRole("button", { name: /Promover/ }).first()).toBeVisible();

  await team.getByRole("button", { name: /Promover/ }).first().click();

  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog).toBeVisible();
  /** A confirmação diz o efeito, não o nome do comando. */
  await expect(dialog).toContainText(/responsável pelo atendimento/i);
  await dialog.getByRole("button", { name: /Promover/ }).click();

  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await settled(page);

  /**
   * O invariante é do servidor: quem foi promovido deixa de ser auxiliar. A
   * tela relê o estado autoritativo e mostra o resultado, sem corrigir nada.
   */
  const teamText = await team.innerText();
  const [, auxiliaryBlock = ""] = teamText.split("auxiliares técnico");
  expect(auxiliaryBlock).not.toContain(operation.auxiliary);

  assertClean(recorder, "promoção");
});

test("nenhum código de contrato aparece na tela", async ({ page }) => {
  const recorder = record(page);
  await login(page);

  const forbidden = [
    "FIELD_TECHNICIAN",
    "TECHNICAL_RESPONSIBLE",
    "RESPONSIBLE_FIELD_TECHNICIAN",
    "AUXILIARY_TECHNICIAN",
    "PROFESSIONAL_ROLE_MISSING",
    "SIGNATURE_MISSING",
    "BUSINESS_UNIT_SCOPE_MISSING",
    "MANAGE_ASSIGNMENTS",
  ];
  const found: string[] = [];

  for (const route of ["/equipe", "/operacoes", "/agenda"]) {
    await page.goto(route);
    await settled(page);
    if (route === "/equipe") {
      /// Onde o vocabulário do contrato teria a melhor chance de vazar.
      await page.getByRole("button", { name: "Ana Campo" }).first().click();
      await expect(
        page.getByText("Técnico em Campo").first(),
      ).toBeVisible({ timeout: 20_000 });
      await settled(page);
    }
    const body = await page.evaluate(() => document.body.innerText);
    for (const term of forbidden) {
      if (body.includes(term)) found.push(`${route}: ${term}`);
    }
  }

  expect(found, "códigos de contrato visíveis").toEqual([]);
  assertClean(recorder, "linguagem do domínio profissional");
});
