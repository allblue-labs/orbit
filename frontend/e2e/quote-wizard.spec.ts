/**
 * O wizard de orçamento, do primeiro passo ao PDF.
 *
 * ## Por que no navegador
 *
 * As regras de avanço têm teste de unidade (`quote-wizard.model.test.ts`). O que
 * só o navegador prova é o resto: que os seletores carregam o que o passo pede,
 * que o botão de gerar executa as **quatro** requisições na ordem, e que o
 * resultado é uma proposta enviada, com equipamento, endereço e responsável — a
 * mesma que a lista mostra e o documento imprime.
 *
 * ## O teste prepara o que vai escolher
 *
 * Cliente com dois endereços e um equipamento, criados pela API. Sem isso o passo
 * 2 não teria o que oferecer, e um wizard que passa por falta de opção não prova
 * nada.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";

import { OWNER, login, record, settled } from "./support";

const API = process.env.ORBIT_API_URL ?? "http://localhost:6001/api/v1";

interface Fixture {
  readonly customerLabel: string;
  readonly assetTag: string;
  readonly addressLabel: string;
}

async function tokenFor(request: APIRequestContext): Promise<string> {
  const auth = await request.post(`${API}/identity/login`, {
    data: { email: OWNER.email, password: OWNER.password },
  });
  return (await auth.json()).data.accessToken as string;
}

async function seed(request: APIRequestContext): Promise<Fixture> {
  const token = await tokenFor(request);
  const headers = { authorization: `Bearer ${token}` };

  const org = await request.get(`${API}/organizations/current`, { headers });
  const businessUnitId = (await org.json()).data.businessUnits[0].id as string;

  const customers = await request.get(`${API}/customers?limit=1`, { headers });
  const page = (await customers.json()).data;
  expect(page.data.length, "precisa de um cliente").toBeGreaterThan(0);
  const customer = page.data[0];

  const marca = `W-${Date.now()}`;
  const addressLabel = `Obra ${marca}`;

  await request.post(`${API}/customers/${customer.id}/addresses`, {
    headers,
    data: {
      label: addressLabel,
      street: "Avenida do Wizard",
      number: "100",
      city: "Recife",
      stateCode: "PE",
    },
  });

  const asset = await request.post(`${API}/assets`, {
    headers,
    data: {
      name: `Chiller ${marca}`,
      category: "EQUIPMENT",
      identifierType: "INTERNAL_CODE",
      identifier: marca,
      location: "Casa de máquinas",
      businessUnitId,
      customerId: customer.id,
    },
  });
  expect(asset.ok(), await asset.text()).toBe(true);

  /* O catálogo precisa de um serviço com preço: o passo 3 só oferece item cujo
     `salePrice` é maior que zero, porque sem preço o servidor recusaria. */
  const service = await request.post(`${API}/catalog/products`, {
    headers,
    data: {
      kind: "SERVICE",
      name: `Manutenção ${marca}`,
      unit: "SERV",
      salePrice: 1500,
      businessUnitId,
    },
  });
  expect(service.ok(), await service.text()).toBe(true);

  return {
    customerLabel: customer.tradeName ?? customer.legalName,
    assetTag: marca,
    addressLabel,
  };
}

test("o wizard monta a proposta e a deixa aguardando o cliente", async ({
  page,
  request,
}) => {
  const fixture = await seed(request);
  const recorder = record(page);

  await login(page);
  await page.goto("/orcamentos");
  await settled(page);

  await page
    .getByRole("button", { name: /Novo orçamento/i })
    .first()
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  /* Passo 1 — do zero é o padrão, então só seguir. */
  await expect(
    dialog.getByRole("button", { name: /Orçamento novo/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("button", { name: /^Continuar$/ }).click();

  /*
   * Passo 2 — cliente pelo seletor que carrega sob demanda.
   *
   * O localizador é o rótulo, não o texto do botão: com `<Label htmlFor>` o nome
   * acessível do controle é "Cliente", e é assim que quem usa leitor de tela o
   * encontra.
   */
  await dialog.getByLabel("Cliente").click();
  await page
    .getByRole("button", { name: fixture.customerLabel })
    .first()
    .click();

  /* O endereço criado agora aparece porque é do cliente escolhido. */
  await dialog.getByLabel("Endereço de execução").click();
  await page
    .getByRole("option", { name: new RegExp(fixture.addressLabel) })
    .click();

  /* O equipamento do cliente, por caixa de seleção. */
  await dialog.getByRole("checkbox").first().check();

  const titulo = `Proposta wizard ${fixture.assetTag}`;
  await dialog.getByLabel("Título").fill(titulo);
  await dialog.getByLabel("Objeto da proposta").fill("Escopo do teste E2E.");

  /* O padrão da abertura é visível antes de emitir — não uma promessa. */
  await expect(dialog.getByLabel("Texto de abertura")).toHaveAttribute(
    "placeholder",
    /honrosa solicitação/,
  );

  await dialog.getByRole("button", { name: /^Continuar$/ }).click();

  /* Passo 3 — um serviço do catálogo. */
  await dialog.getByPlaceholder("Buscar serviço").fill(fixture.assetTag);
  await settled(page);
  await dialog
    .getByRole("button", { name: /^Adicionar$/ })
    .first()
    .click();
  /* O cabeçalho do grupo — é o que prova que o item entrou como serviço. A aba e
     o passo também se chamam "Serviços", e por texto o localizador casaria
     quatro elementos. */
  await expect(dialog.getByRole("heading", { name: "Serviços" })).toBeVisible();
  await dialog.getByRole("button", { name: /^Continuar$/ }).click();

  /* Passo 4 — desconto com motivo, e o extenso do total. */
  /* `exact`: "Motivo do desconto" também contém "Desconto". */
  await dialog.getByLabel("Desconto", { exact: true }).fill("500");
  await dialog
    .getByLabel("Motivo do desconto")
    .fill("contrato anual de manutenção");
  /* 1500 − 500. O extenso é o mesmo código que o PDF usa. */
  await expect(dialog.getByText("mil reais")).toBeVisible();
  await dialog.getByRole("button", { name: /^Continuar$/ }).click();

  /* Passo 5 — o responsável já vem marcado como quem está usando. */
  await expect(dialog.getByRole("button", { pressed: true })).toBeVisible();
  await dialog.getByRole("button", { name: /^Continuar$/ }).click();

  /* Passo 6 — gerar só libera depois da confirmação. */
  const gerar = dialog.getByRole("button", { name: /Gerar orçamento/ });
  await expect(gerar).toBeDisabled();
  await dialog.getByRole("checkbox").first().check();
  await expect(gerar).toBeEnabled();

  await gerar.click();

  /* O wizard abre a proposta criada. A URL prova que o `POST` passou. */
  await page.waitForURL(/\/orcamentos\/[0-9a-f-]+$/, { timeout: 30_000 });
  await settled(page);

  await expect(page.getByText(titulo).first()).toBeVisible();

  /*
   * Enviada, não rascunho — e conferido na **API**, não no texto da tela.
   *
   * A afirmação é sobre estado de domínio: `canApprove` só vale em `SENT`, e é
   * isso que faz o botão "Aprovado" da lista funcionar. Procurar o rótulo na
   * página seria frágil — "Enviado" aparece como nome de aba e no histórico — e
   * de fato um asserto por texto aqui passou com a proposta em rascunho.
   */
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const conferencia = await request.get(`${API}/quotes/${id}`, {
    headers: { authorization: `Bearer ${await tokenFor(request)}` },
  });
  const criada = (await conferencia.json()).data;
  expect(criada.status).toBe("SENT");
  expect(criada.transitions.canApprove).toBe(true);
  /* E o escopo que os passos montaram chegou inteiro. */
  expect(criada.assets).toHaveLength(1);
  expect(criada.serviceAddress).not.toBeNull();
  expect(criada.responsible).not.toBeNull();
  expect(criada.discountReason).toBe("contrato anual de manutenção");
  expect(Number(criada.discount)).toBe(500);

  expect(recorder.pageErrors, "exceções não tratadas").toEqual([]);
  expect(recorder.reactWarnings, "avisos de React").toEqual([]);
  expect(
    recorder.consoleErrors.filter((erro) => !/403 \(Forbidden\)/.test(erro)),
    "console.error além do 403 esperado",
  ).toEqual([]);
});
