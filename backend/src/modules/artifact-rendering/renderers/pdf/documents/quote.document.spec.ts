/**
 * O orçamento premium.
 *
 * É o único documento da série que pede uma decisão, então o que se testa é o
 * que atrapalharia essa decisão: o total difícil de achar, a tabela de
 * materiais sem preço, o desconto escondido numa linha de item, e a proposta
 * sem onde assinar.
 */
import { QuoteDocumentService } from '../../../quote-document.service';
import type { QuoteDocumentInput } from './quote.document';
import { pdfText, pdfPageCount } from '../../../../../../test/support/pdf-text';

function entrada(
  options: {
    servicos?: number;
    materiais?: number;
    desconto?: number;
    total?: number;
  } = {},
): QuoteDocumentInput {
  const servicos = Array.from(
    { length: options.servicos ?? 2 },
    (_, indice) => ({
      kind: 'SERVICE',
      description: `Serviço ${indice + 1}`,
      unit: 'SERV',
      quantity: 4,
      unitPrice: 250,
      total: 1000,
    }),
  );
  const materiais = Array.from(
    { length: options.materiais ?? 1 },
    (_, indice) => ({
      kind: 'PRODUCT',
      description: `Material ${indice + 1}`,
      sku: `SKU-${indice}`,
      unit: 'M',
      quantity: 3.5,
      unitPrice: 18.4,
      total: 64.4,
    }),
  );

  return {
    quote: {
      code: 'ORC-000011',
      title: 'Manutenção do parque de climatização',
      status: 'SENT',
      issuedAt: '25/09/2026',
      validUntil: '25/10/2026',
      validityDays: 30,
      notes: 'Proposta para manutenção da torre A.',
      author: 'Helena Braga',
      operationCode: 'OP-000086',
    },
    customer: {
      name: 'Edifício Aurora',
      legalName: 'Condomínio do Edifício Aurora',
      document: 'CNPJ 12.334.332/0001-23',
    },
    items: [...servicos, ...materiais],
    totals: {
      subtotal: 2952.7,
      discount: options.desconto ?? 152.7,
      total: options.total ?? 2800,
    },
  };
}

const emissor = { tradeName: 'Clima Norte' };

describe('Orçamento premium', () => {
  const service = new QuoteDocumentService();

  const render = (input: QuoteDocumentInput) =>
    service.render({
      quote: input,
      emitter: emissor,
      generatedAt: new Date('2026-09-25T18:00:00.000Z'),
    });

  it('põe o total em destaque, com o extenso', async () => {
    const texto = pdfText(await render(entrada()));

    expect(texto).toContain('VALOR TOTAL DA PROPOSTA');
    expect(texto).toContain('2.800,00');
    /* O extenso protege o número e é o que se confere em voz alta ao
       aprovar por telefone. */
    expect(texto).toContain('dois mil e oitocentos reais');
  });

  it('dá preço aos materiais, e não só quantidade', async () => {
    const texto = pdfText(await render(entrada()));

    expect(texto).toContain('Materiais e fornecimentos');
    /* O modelo do setor lista material só com descrição e quantidade: quem
       lê não confere de onde veio o subtotal, e a proposta passa a pedir
       confiança em vez de mostrar a conta. */
    expect(texto).toContain('18,40');
    expect(texto).toContain('64,40');
  });

  it('numera os itens de forma contínua entre os grupos', async () => {
    const texto = pdfText(await render(entrada({ servicos: 2, materiais: 2 })));

    /* Reiniciar a numeração em cada grupo faria existir dois "item 01" na
       mesma proposta — e é por número que o cliente questiona uma linha. */
    expect(texto).toContain('03Material 1');
    expect(texto).toContain('04Material 2');
  });

  it('tira o desconto da tabela e põe no resumo', async () => {
    const texto = pdfText(await render(entrada()));

    expect(texto).toContain('SUBTOTAL');
    expect(texto).toContain('DESCONTO');
    /* Hífen ASCII: o sinal de menos tipográfico não existe no WinAnsi da
       Helvetica e sai impresso como aspas. */
    expect(texto).toContain('- R$ 152,70');
    expect(texto).not.toContain('"R$');
  });

  it('omite o resumo quando não há desconto a explicar', async () => {
    const texto = pdfText(
      await render(entrada({ desconto: 0, total: 2952.7 })),
    );

    /* "SUBTOTAL" não serve para afirmar isto: é também o cabeçalho de uma
       coluna da tabela de itens. "DESCONTO" só existe no resumo. */
    expect(texto).not.toContain('DESCONTO');
    expect(texto).toContain('VALOR TOTAL DA PROPOSTA');
  });

  it('imprime os valores como vieram, sem refazer a conta', async () => {
    /* Um total que não bate com a soma dos itens é problema do domínio, e é
       lá que se corrige. Recalcular na impressão criaria uma segunda fonte de
       verdade sobre dinheiro, e a folha contradiria a tela. */
    const texto = pdfText(await render(entrada({ total: 1 })));

    expect(texto).toContain('R$ 1,00');
    expect(texto).toContain('um real');
  });

  it('dá onde o cliente aprovar', async () => {
    const texto = pdfText(await render(entrada()));

    expect(texto).toContain('Aceite');
    expect(texto).toContain('autorizo a execução dos serviços');
    /* Sem linha de data, a aprovação acontece por outro canal e fica fora do
       documento. */
    expect(texto).toContain('Data:');
    expect(texto).toContain('Edifício Aurora');
  });

  it('não repete a validade em duas seções', async () => {
    const texto = pdfText(await render(entrada()));

    expect(texto).toContain('25/10/2026 (30 dias)');
    expect(texto.match(/25\/10\/2026/g) ?? []).toHaveLength(1);
  });

  it('traduz a situação da proposta', async () => {
    const texto = pdfText(await render(entrada()));

    expect(texto).toContain('Enviada');
    expect(texto).not.toContain('SENT');
  });

  it('distribui a tabela de itens e repete o cabeçalho', async () => {
    const bytes = await render(entrada({ servicos: 60 }));
    const texto = pdfText(bytes);

    expect(pdfPageCount(bytes)).toBeGreaterThan(1);
    /* A legenda é do documento, não de uma célula: em minúscula, acima da
       tabela. Concatenada ao cabeçalho da primeira coluna — que foi o defeito
       — ela estourava a largura reservada para a palavra "Item" e
       desalinhava o cabeçalho inteiro na segunda página. */
    expect(texto).toContain('(continuação)');
    expect(texto).not.toContain('ITEM (');
    expect(texto).toContain('Serviço 60');
  });

  /* ---------------------------------------------------------------- */
  /* Desconto                                                          */
  /* ---------------------------------------------------------------- */

  it('imprime o motivo ao lado do desconto', async () => {
    const base = entrada();
    const texto = pdfText(
      await render({
        ...base,
        quote: {
          ...base.quote,
          discountReason: 'contrato anual de manutenção',
        },
      }),
    );

    /* Junto do valor, não numa seção própria: quem lê o abatimento é quem
       pergunta o motivo, e separá-los deixaria a resposta meia página adiante
       da pergunta. */
    expect(texto).toContain('contrato anual de manutenção');
    expect(texto).toContain('152,70');
  });

  it('sem motivo, não imprime a linha de explicação', async () => {
    const texto = pdfText(await render(entrada()));

    expect(texto).toContain('152,70');
    expect(texto).not.toContain('Desconto:');
  });

  /* ---------------------------------------------------------------- */
  /* Abertura                                                          */
  /* ---------------------------------------------------------------- */

  it('abre com a fórmula do setor quando a proposta não traz outra', async () => {
    const texto = pdfText(await render(entrada()));

    expect(texto).toContain('Atendendo à honrosa solicitação de V.Sa.');
  });

  it('a abertura da proposta vence o padrão', async () => {
    const base = entrada();
    const texto = pdfText(
      await render({
        ...base,
        quote: { ...base.quote, introText: 'Conforme conversamos na visita,' },
      }),
    );

    expect(texto).toContain('Conforme conversamos na visita,');
    expect(texto).not.toContain('honrosa solicitação');
  });

  it('abertura apagada imprime nada, e não o padrão de volta', async () => {
    /* String vazia é escolha. Reinserir o padrão desfaria em silêncio o que a
       pessoa apagou de propósito. */
    const base = entrada();
    const texto = pdfText(
      await render({ ...base, quote: { ...base.quote, introText: '   ' } }),
    );

    expect(texto).not.toContain('honrosa solicitação');
  });

  /* ---------------------------------------------------------------- */
  /* Equipamentos                                                      */
  /* ---------------------------------------------------------------- */

  it('lista os equipamentos com identificação e local', async () => {
    const base = entrada();
    const texto = pdfText(
      await render({
        ...base,
        assets: [
          {
            name: 'Split Hi-Wall 12k',
            identifier: 'AC-014',
            location: 'Recepção',
          },
          {
            name: 'Chiller 40TR',
            identifier: 'CH-002',
            location: 'Casa de máquinas',
          },
        ],
      }),
    );

    expect(texto).toContain('Equipamentos');
    /* Identificação e local são o que o cliente confere item por item — "é o da
       recepção ou o do depósito?". Só o nome não responde. */
    expect(texto).toContain('AC-014');
    expect(texto).toContain('Recepção');
    expect(texto).toContain('CH-002');
    expect(texto).toContain('Casa de máquinas');
  });

  it('sem equipamento, não imprime a seção vazia', async () => {
    const texto = pdfText(await render(entrada()));

    /* O título da seção, como o PDF o escreve. Em maiúscula o asserto passaria
       à toa — só o cabeçalho da tabela é maiúsculo. */
    expect(texto).not.toContain('Equipamentos');
  });

  /* ---------------------------------------------------------------- */
  /* Quem assina                                                       */
  /* ---------------------------------------------------------------- */

  it('quem assina é o responsável, não a empresa', async () => {
    const base = entrada();
    const texto = pdfText(
      await render({
        ...base,
        responsible: {
          name: 'Marcos Tavares',
          roleLabel: 'Engenheiro mecânico',
        },
      }),
    );

    /* Antes daqui a linha do proponente levava o nome fantasia do emissor, e a
       pessoa que responde aparecia em letra miúda como "credencial". Quem
       recebe a proposta precisa saber com quem falar. */
    expect(texto).toContain('Marcos Tavares');
    expect(texto).toContain('Engenheiro mecânico');
  });

  it('sem responsável, o emissor continua assinando', async () => {
    /* Proposta anterior a este campo não perde o bloco de aceite. */
    const texto = pdfText(await render(entrada()));

    expect(texto).toContain('Clima Norte');
    expect(texto).toContain('Responsável pela proposta');
    /* A linha do cliente existe, com a data para preencher à mão. */
    expect(texto).toContain('Data: ____ / ____ / ________');
  });
});
