/**
 * A lista de propostas: colunas, ações da linha e o painel de resumo.
 *
 * ## Por que no navegador
 *
 * O que se prova aqui não é que os componentes renderizam — é que a linha
 * carrega o que o contrato passou a publicar (`assets`, `responsible`), que
 * clicar abre o resumo, e que os controles da linha **não** abrem o resumo por
 * cima de si mesmos. Nada disso um teste de unidade alcança: depende do payload
 * real e da propagação de eventos do DOM.
 *
 * ## O teste cria a proposta que vai ler
 *
 * Uma lista vazia passaria por qualquer asserção sobre colunas. E depender de um
 * orçamento deixado por outra execução faria o resultado mudar conforme o que
 * rodou antes. A proposta nasce aqui, pela API, com equipamento e responsável —
 * que é justamente o que a linha precisa mostrar.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

import { OWNER, login, record, settled } from "./support";

const API = process.env.ORBIT_API_URL ?? "http://localhost:6001/api/v1";

interface Seeded {
  readonly code: string;
  /** O nome que a coluna Responsável deve mostrar, como o servidor o publica. */
  readonly responsible: string;
  /** Identificador do equipamento, que a célula de Equipamentos deve trazer. */
  readonly assetTag: string;
}

/** Cria a proposta pela API e devolve o que a linha precisa mostrar. */
async function seedQuote(request: APIRequestContext): Promise<Seeded> {
  const login = await request.post(`${API}/identity/login`, {
    data: { email: OWNER.email, password: OWNER.password },
  });
  const token = (await login.json()).data.accessToken as string;
  const auth = { authorization: `Bearer ${token}` };

  const org = await request.get(`${API}/organizations/current`, {
    headers: auth,
  });
  const businessUnitId = (await org.json()).data.businessUnits[0].id as string;

  /* Duas camadas: o envelope da API (`{success, data}`) e a paginação
     (`{data, meta}`). Uma só levaria ao `undefined` de quem confunde as duas. */
  const customers = await request.get(`${API}/customers?limit=1`, {
    headers: auth,
  });
  const page = (await customers.json()).data;
  expect(
    page.data.length,
    "o inquilino precisa de ao menos um cliente",
  ).toBeGreaterThan(0);
  const customerId = page.data[0].id as string;

  /* Identificador único por execução: `identifier` é único por inquilino, e
     reaproveitar o de ontem faria o segundo `POST` falhar. */
  const marca = `E2E-${Date.now()}`;
  const asset = await request.post(`${API}/assets`, {
    headers: auth,
    data: {
      name: "Split Hi-Wall 12k",
      category: "EQUIPMENT",
      identifierType: "INTERNAL_CODE",
      identifier: marca,
      location: "Recepção",
      businessUnitId,
      customerId,
    },
  });
  const assetId = (await asset.json()).data.id as string;

  const quote = await request.post(`${API}/quotes`, {
    headers: auth,
    data: {
      customerId,
      title: `Proposta E2E ${marca}`,
      assetIds: [assetId],
      validUntil: "2099-12-31",
    },
  });
  expect(quote.ok(), await quote.text()).toBe(true);
  const created = (await quote.json()).data;
  /* O nome vem da resposta, não de uma constante do teste: é o servidor que
     decide como o responsável se chama, e adivinhar aqui faria o teste passar
     com a coluna mostrando outra coisa. */
  expect(created.responsible).not.toBeNull();

  await request.post(`${API}/quotes/${created.id}/items`, {
    headers: auth,
    data: {
      description: "Substituição de compressor",
      unit: "SERV",
      quantity: 1,
      unitPrice: 3200,
    },
  });

  return {
    code: created.code as string,
    responsible: created.responsible.displayName as string,
    assetTag: marca,
  };
}

test("a linha mostra equipamento e responsável, e abre o resumo", async ({
  page,
  request,
}) => {
  const { code, responsible, assetTag } = await seedQuote(request);
  const recorder = record(page);

  await login(page);
  await page.goto("/orcamentos");
  await settled(page);

  /* As colunas que o contrato passou a sustentar. */
  for (const coluna of [
    "Número",
    "Equipamentos",
    "Valor total",
    "Vencimento",
    "Responsável",
    "Ações",
  ]) {
    await expect(
      page.getByRole("columnheader", { name: coluna }),
    ).toBeVisible();
  }

  const row = page.getByRole("row").filter({ hasText: code });
  await expect(row).toBeVisible();

  /* O equipamento vem na **listagem**: sem isso a célula ficaria com um traço, e
     a coluna existiria sem responder nada. */
  /* `exact`: o título da proposta também contém a etiqueta, e sem isso o
     localizador casa dois elementos e o modo estrito reprova. */
  await expect(row.getByText(assetTag, { exact: true })).toBeVisible();

  /* O responsável é quem criou, quando ninguém disse outro. */
  await expect(row).toContainText(responsible);

  /*
   * Baixar não pode abrir o resumo.
   *
   * A linha inteira é clicável, então sem `stopPropagation` no contêiner das
   * ações o clique subiria e o painel apareceria por cima do download — a pessoa
   * pediria um PDF e ganharia uma gaveta. O download em si acontece: o
   * `Promise` do arquivo é o que confirma que o botão fez o seu trabalho.
   */
  const baixar = row.getByRole("button", {
    name: /Baixar o orçamento em PDF/i,
  });
  await expect(baixar).toBeVisible();

  const arquivo = page.waitForEvent("download");
  await baixar.click();
  expect((await arquivo).suggestedFilename()).toMatch(/\.pdf$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  /* Clicar na linha abre o painel, com os itens que só o detalhe carrega. */
  await row.click();
  const panel = page.getByRole("dialog");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(code);
  await expect(panel.getByText("Substituição de compressor")).toBeVisible();
  await expect(
    panel.getByRole("link", { name: /Abrir a proposta/i }),
  ).toBeVisible();

  expect(recorder.pageErrors, "exceções não tratadas").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React").toEqual([]);
  expect(
    recorder.consoleErrors.filter((erro) => !/403 \(Forbidden\)/.test(erro)),
    "console.error além do 403 esperado",
  ).toEqual([]);
});
