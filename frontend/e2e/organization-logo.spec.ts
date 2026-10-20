/**
 * O logo da empresa em Configurações › Organização.
 *
 * ## Por que este teste existe
 *
 * O que faltava era a **opção**: a marca só podia ser enviada de dentro do
 * diálogo de edição de uma unidade de negócio, e quem opera com uma unidade
 * abria as configurações da empresa à procura dela sem encontrar nada. Um teste
 * de unidade provaria que o componente renderiza; não provaria que ele está
 * montado onde a pessoa procura.
 *
 * Por isso a asserção começa navegando até a aba e termina com a imagem
 * desenhada na tela — o caminho inteiro, incluindo o `PUT` e a releitura.
 *
 * ## O teste zera o estado antes de afirmar
 *
 * A marca é persistente por organização: uma execução anterior — ou um teste
 * manual — deixa a empresa timbrada, e um teste que presumisse a tela vazia
 * passaria ou falharia conforme o que rodou antes dele.
 *
 * ## Por que o arquivo é gerado aqui
 *
 * O navegador reduz a imagem antes de enviar (`prepareBrandImage`), e o que
 * chega ao servidor é o resultado dessa redução. Um PNG escrito no próprio teste
 * mantém a prova sem depender de um binário guardado no repositório.
 */
import { expect, test } from "@playwright/test";

import { login, record, settled } from "./support";

/**
 * PNG 16×16 sólido — verificado no próprio Chromium do Playwright.
 *
 * `prepareBrandImage` decodifica com `createImageBitmap`, que é mais exigente
 * que um leitor de cabeçalho: um PNG com CRC errado passa por `file(1)` e é
 * recusado aqui, com a mesma mensagem de um arquivo corrompido de verdade.
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGM4YWNDEmIY" +
    "1TCqYfhqAACrxkAQIqaBzAAAAABJRU5ErkJggg==",
  "base64",
);

test("a aba Organização envia e mostra o logo da empresa", async ({ page }) => {
  const recorder = record(page);

  await login(page);
  await page.goto("/configuracoes?secao=organizacao");
  await settled(page);

  /* A opção existe — é literalmente o que faltava. */
  const enviar = page.getByRole("button", { name: /Enviar logo|Trocar logo/ });
  await expect(enviar).toBeVisible();

  /* Zera o que uma execução anterior tenha deixado. */
  const remover = page.getByRole("button", { name: /^Remover$/ });
  if (await remover.isVisible()) {
    await remover.click();
    await settled(page);
  }

  /* Sem marca, a tela diz o que acontece, e não fica só vazia. */
  await expect(page.getByText(/o documento sai sem timbre/i)).toBeVisible();

  const escolha = page.waitForEvent("filechooser");
  await enviar.click();
  await (
    await escolha
  ).setFiles({ name: "marca.png", mimeType: "image/png", buffer: PNG });

  await settled(page);

  /* A prévia desenha a imagem guardada, o que só é possível se o `PUT` passou e
     `GET current/logo` a devolveu. */
  const previa = page.getByRole("img", { name: "Logo da empresa" });
  await expect(previa).toBeVisible();
  await expect(previa).toHaveAttribute(
    "src",
    /^data:image\/(png|jpeg);base64,/,
  );

  /* E dá para desfazer, sem levar o resto da organização junto. */
  await remover.click();
  await settled(page);
  await expect(page.getByText(/o documento sai sem timbre/i)).toBeVisible();

  /*
   * Não dá para usar `assertClean` aqui: a mesma página busca
   * `GET /organizations/current/business-units`, que responde **403 de
   * propósito** quando o plano não tem a capability — é o que produz o painel
   * "Sua conta não tem acesso a esta informação". O navegador registra o
   * não-2xx no console, e isso não é defeito desta tela.
   *
   * Então o crivo é o mesmo, menos esse: qualquer outro `console.error`, e
   * qualquer exceção, aviso de React ou requisição falha, reprovam.
   */
  const ruidoConhecido = /403 \(Forbidden\)/;
  expect(recorder.pageErrors, "exceções não tratadas").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React").toEqual([]);
  expect(recorder.failedRequests, "requisições falhas").toEqual([]);
  expect(
    recorder.consoleErrors.filter((erro) => !ruidoConhecido.test(erro)),
    "console.error além do 403 esperado de unidades",
  ).toEqual([]);
});
