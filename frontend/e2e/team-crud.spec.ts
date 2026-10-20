/**
 * Cadastro de pessoas da equipe, senha temporária e troca forçada.
 *
 * ## O que se prova
 *
 * Que o owner cadastra um técnico sem convite e recebe uma senha temporária
 * que aparece **uma vez** — e que essa senha não abre o painel web.
 *
 * A última parte é a que mais importa, e mudou. O técnico operacional existe
 * para o aplicativo de campo; entrar no painel lhe dava a organização inteira,
 * e nada no backend o impedia. Hoje a recusa é por superfície do papel
 * (`roles.allowed_surfaces`), feita pelo servidor e depois de conferir a
 * credencial.
 *
 * A troca forçada de senha na web continua existindo para quem tem acesso ao
 * painel; o técnico a faz pelo aplicativo, e isso é coberto em
 * `mobile/test/features/forced_password_change_test.dart`.
 */
import { expect, test } from "@playwright/test";

import { bff } from "./provision";
import { assertClean, login, record, settled } from "./support";

test("cadastra o técnico, mostra a senha uma vez e força a troca", async ({
  page,
}) => {
  const recorder = record(page);
  await page.setViewportSize({ width: 1440, height: 1200 });
  await login(page);

  await page.goto("/equipe");
  await settled(page);

  /* ---------------------------------------------------------------- */
  /* As abas que saíram                                                */
  /* ---------------------------------------------------------------- */

  for (const rotulo of [
    "Profissionais",
    "Localização",
    "Convites",
    "Papéis",
    "Inteligência",
  ]) {
    await expect(
      page.getByRole("tab", { name: rotulo }),
      `a aba ${rotulo} deveria ter saído`,
    ).toHaveCount(0);
  }
  await expect(page.getByRole("tab", { name: "Usuários" })).toBeVisible();

  /* ---------------------------------------------------------------- */
  /* Cadastro                                                          */
  /* ---------------------------------------------------------------- */

  const carimbo = Date.now();
  const nomeDeEntrada = `tecnico.e2e.${carimbo}`;

  await page.getByRole("button", { name: "Cadastrar usuário" }).click();
  await page.locator("#member-first-name").fill("Joao");
  await page.locator("#member-last-name").fill(`Campo ${carimbo}`);

  /**
   * O campo pede o **nome de entrada**, e o domínio já está dentro dele.
   *
   * Quem se cadastra aqui recebe senha temporária e não recebe mensagem nenhuma —
   * o endereço é o login. O domínio é da organização e entra sozinho, e o teste o
   * lê da tela em vez de inventar: inventá-lo provaria que o teste sabe montar um
   * e-mail, não que a tela monta o mesmo que o servidor aceita.
   *
   * O domínio ficava numa caixa ao lado do campo; passou para dentro. Ler o
   * valor composto é melhor do que ler aquele sufixo: prova que a tela montou o
   * endereço, e não só que ela sabe desenhar o domínio em algum canto.
   */
  const campoEmail = page.locator("#member-email");
  await campoEmail.fill(nomeDeEntrada);

  const emailTecnico = (await campoEmail.inputValue()).trim();
  expect(emailTecnico, "o campo precisa compor o endereço inteiro").toMatch(
    new RegExp(`^${nomeDeEntrada}@[a-z0-9-]+\\.[a-z]+$`),
  );

  /*
   * O cadastro tem quatro passos — dados, papel, acessos, revisão — e o teste
   * percorre os quatro. Ele pulava direto para "Cadastrar", que só existe no último:
   * o seletor de papel nem está montado no primeiro.
   */
  const continuar = page.getByRole("button", {
    name: "Continuar",
    exact: true,
  });
  await continuar.click();

  await page.locator("#member-role").click();
  /*
   * O nome do papel é o que a tela mostra, e ele mudou.
   *
   * O catálogo dizia "Técnico operador" e este teste procurava "Técnico
   * operacional": nunca achava a opção. O produto passou a usar "Técnico
   * Operacional" nos dois lugares — papel de acesso e papel profissional —, porque
   * "Técnico responsável" e "Responsável Técnico" coexistindo em telas diferentes era
   * a mesma palavra para coisas opostas.
   */
  await page.getByRole("option", { name: "Técnico Operacional" }).click();

  /// O papel se explica antes de ser concedido, não depois.
  await expect(page.getByText(/Executa o atendimento em campo/)).toBeVisible();
  await continuar.click();

  /// Acessos: o padrão do papel e a unidade principal já vêm escolhidos.
  await continuar.click();

  /// A revisão mostra o login montado, e não o nome digitado.
  await expect(page.getByText(emailTecnico)).toBeVisible();

  await page.getByRole("button", { name: "Cadastrar", exact: true }).click();

  const senhaVisivel = page.getByTestId("temporary-password");
  await expect(senhaVisivel).toBeVisible();
  const senha = ((await senhaVisivel.textContent()) ?? "").trim();
  expect(senha).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  /// O diálogo diz que é a única vez — antes de fechar, não depois.
  await expect(page.getByText(/uma única vez/i)).toBeVisible();
  await page.getByRole("button", { name: "Concluir" }).click();

  /**
   * A prova de que a pessoa entrou é o servidor, não a primeira página da lista.
   *
   * A listagem pagina por nome, 20 por vez. Procurar o recém-cadastrado ali
   * supõe que ele caiu na página 1 — verdade nas primeiras execuções e falso
   * depois que a organização passa de vinte pessoas, que foi como este teste
   * reprovou. A busca da tela também não resolveria: ela filtra **a página
   * carregada**, e a própria tela diz isso.
   *
   * O que importa provar é que o cadastro persistiu com o papel certo — e logo
   * abaixo, que a senha devolvida realmente autentica.
   */
  const membros = await bff(
    page,
    "get",
    "/api/orbit/organizations/current/members?limit=100",
  );
  const corpo = (await membros.json()) as {
    data: { data: { email: string; role: { key: string } }[] };
  };
  const cadastrado = corpo.data.data.find(
    (membro) => membro.email === emailTecnico,
  );
  expect(
    cadastrado,
    "o técnico cadastrado precisa estar na equipe",
  ).toBeTruthy();
  expect(cadastrado?.role.key).toBe("FIELD_TECHNICIAN");

  /**
   * O portão de console fecha aqui.
   *
   * O que vem a seguir é uma recusa **deliberada**: o servidor responde `403`
   * e o navegador registra isso como erro de console, como faria com qualquer
   * status de erro. Manter `assertClean` depois disso transformaria a prova de
   * que a regra funciona numa reprovação.
   */
  assertClean(recorder, "cadastro de equipe");

  /* ---------------------------------------------------------------- */
  /* O técnico não entra pelo painel — nem com a senha certa            */
  /* ---------------------------------------------------------------- */

  /**
   * Sessão nova, e não a do owner.
   *
   * O logout é `POST` — navegar para a rota deixava a sessão do owner de pé, e
   * `/login` então redirecionava direto para o painel. O contexto continuava
   * autenticado e o teste media a tela errada.
   */
  await page.request.post("/api/auth/logout").catch(() => undefined);
  await page.context().clearCookies();
  await page.goto("/login");
  await settled(page);

  await page.getByLabel(/e-?mail/i).fill(emailTecnico);
  await page.getByLabel(/senha/i).first().fill(senha);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  /**
   * A regressão que esta parte tranca.
   *
   * Antes, a senha temporária levava o técnico à troca obrigatória **na web** —
   * e, trocada a senha, ele entrava no painel e enxergava a organização
   * inteira: clientes, contratos, financeiro. O papel dele existe para o
   * aplicativo de campo, e nada no backend o impedia.
   *
   * Agora o servidor recusa a entrada por superfície (`SURFACE_NOT_ALLOWED`),
   * e a recusa acontece **depois** de conferir a senha: antes disso seria um
   * oráculo dizendo quais endereços existem e são de campo.
   */
  await expect(page.getByText(/aplicativo Orbit de campo/i)).toBeVisible({
    timeout: 20_000,
  });

  /** E continua no login: nenhuma sessão foi criada. */
  await expect(page).toHaveURL(/\/login/);

  /**
   * Nem por URL direta.
   *
   * Sem sessão, qualquer rota do produto devolve ao login — é o que garante
   * que a recusa não seja só a ausência de um botão.
   */
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/, { timeout: 30_000 });
});
