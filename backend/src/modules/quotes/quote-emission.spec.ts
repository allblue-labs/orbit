import { Prisma } from '@prisma/client';
import {
  addressText,
  dateOnlyText,
  decimalText,
  documentText,
  itemsText,
  quantityText,
  quoteAnswers,
  type QuoteEmissionSource,
} from './quote-emission';

/**
 * O documento de orçamento, campo por campo.
 *
 * Os números chegam como `Prisma.Decimal`, e é por isso que o teste os constrói
 * assim em vez de usar `number`: um `Decimal` não é um número para o JavaScript —
 * `toFixed` não existe nele, e `Number(decimal)` dá `NaN` em algumas versões. A
 * conversão é a parte que erra, então é a parte que o teste exerce de verdade.
 */
const decimal = (value: string) => new Prisma.Decimal(value);

const fonte = (
  patch: Partial<QuoteEmissionSource> = {},
): QuoteEmissionSource => ({
  code: 'ORC-0042',
  title: 'Manutenção preventiva dos splits',
  total: decimal('1850.50'),
  issuedAt: new Date('2026-03-15T12:00:00.000Z'),
  items: [],
  customer: { legalName: 'Padaria Aurora LTDA', tradeName: 'Padaria Aurora' },
  ...patch,
});

const resposta = (
  answers: readonly { sectionId: string; fieldId: string; value: string }[],
  sectionId: string,
  fieldId: string,
) => answers.find((a) => a.sectionId === sectionId && a.fieldId === fieldId);

describe('o documento emitido do orçamento', () => {
  describe('dinheiro', () => {
    it('sai com ponto e duas casas, para o Financeiro reconhecer', () => {
      expect(decimalText(decimal('1850.5'))).toBe('1850.50');
    });

    it('converte Decimal, que não é número para o JavaScript', () => {
      expect(decimalText(decimal('0.01'))).toBe('0.01');
      expect(decimalText(decimal('1234567.89'))).toBe('1234567.89');
    });

    /** Valor ausente não vira `NaN` impresso no documento do cliente. */
    it('o que não é número vira zero, e não NaN', () => {
      expect(decimalText(null)).toBe('0.00');
      expect(decimalText(undefined)).toBe('0.00');
      expect(decimalText('abc')).toBe('0.00');
    });
  });

  describe('quantidade', () => {
    /**
     * `2.000` é dois.
     *
     * A coluna guarda três casas porque existe meia hora de serviço, não porque
     * "2 unidades" precise de três zeros na frente de quem lê a proposta.
     */
    it('não imprime zeros decorativos', () => {
      expect(quantityText(decimal('2.000'))).toBe('2');
      expect(quantityText(decimal('1.500'))).toBe('1.5');
      expect(quantityText(decimal('0.250'))).toBe('0.25');
    });

    it('o que não é número vira zero', () => {
      expect(quantityText(null)).toBe('0');
    });
  });

  describe('data', () => {
    /**
     * `@db.Date` não tem hora, e o fuso não pode puxar o dia para trás.
     *
     * Uma validade de 31/03 que imprime 30/03 é um documento com a data errada —
     * e é o tipo de erro que só aparece em produção, num fuso negativo.
     */
    it('é a data civil, sem o fuso mover o dia', () => {
      expect(dateOnlyText(new Date('2026-03-31T00:00:00.000Z'))).toBe(
        '2026-03-31',
      );
    });

    it('ausente é ausente, e não a data de hoje', () => {
      expect(dateOnlyText(null)).toBeUndefined();
      expect(dateOnlyText(undefined)).toBeUndefined();
    });
  });

  describe('itens', () => {
    it('viram uma linha por item, com valor em português', () => {
      const texto = itemsText([
        {
          description: 'Limpeza de evaporadora',
          unit: 'UN',
          quantity: decimal('3.000'),
          unitPrice: decimal('250.00'),
          total: decimal('750.00'),
        },
      ]);
      expect(texto).toContain('Limpeza de evaporadora');
      expect(texto).toContain('3 UN');
      /* O separador de milhar do pt-BR é o ponto, e o decimal é a vírgula: este
         texto é lido por quem recebe a proposta, não por outro programa. */
      expect(texto).toContain('R$');
      expect(texto).toContain('250,00');
      expect(texto).toContain('750,00');
    });

    it('uma linha por item, na ordem recebida', () => {
      const texto = itemsText([
        {
          description: 'Primeiro',
          unit: 'UN',
          quantity: decimal('1'),
          unitPrice: decimal('10'),
          total: decimal('10'),
        },
        {
          description: 'Segundo',
          unit: 'UN',
          quantity: decimal('1'),
          unitPrice: decimal('20'),
          total: decimal('20'),
        },
      ]);
      const linhas = texto.split('\n');
      expect(linhas).toHaveLength(2);
      expect(linhas[0]).toContain('Primeiro');
      expect(linhas[1]).toContain('Segundo');
    });

    /** A observação qualifica a linha de cima; colada viraria parte da descrição. */
    it('a observação do item entra recuada, em linha própria', () => {
      const texto = itemsText([
        {
          description: 'Troca de filtro',
          unit: 'UN',
          quantity: decimal('1'),
          unitPrice: decimal('80'),
          total: decimal('80'),
          notes: 'Filtro fornecido pelo cliente',
        },
      ]);
      const linhas = texto.split('\n');
      expect(linhas).toHaveLength(2);
      expect(linhas[1]).toMatch(/^\s{4}Filtro fornecido pelo cliente$/);
    });

    it('sem itens, o texto é vazio e o campo não é gravado', () => {
      expect(itemsText([])).toBe('');
      expect(
        resposta(quoteAnswers(fonte()), 'escopo', 'itens'),
      ).toBeUndefined();
    });
  });

  describe('endereço e documento', () => {
    it('o endereço sai numa linha', () => {
      expect(
        addressText({
          street: 'Rua das Flores',
          number: '120',
          district: 'Boa Viagem',
          city: 'Recife',
          stateCode: 'PE',
        }),
      ).toBe('Rua das Flores, 120 — Boa Viagem — Recife/PE');
    });

    it('endereço ausente é ausente', () => {
      expect(addressText(null)).toBeUndefined();
      expect(addressText({})).toBeUndefined();
    });

    it('o documento leva o tipo quando ele existe', () => {
      expect(documentText('CNPJ', '12.345.678/0001-90')).toBe(
        'CNPJ 12.345.678/0001-90',
      );
      expect(documentText(null, '12.345.678/0001-90')).toBe(
        '12.345.678/0001-90',
      );
      expect(documentText('CNPJ', null)).toBeUndefined();
    });
  });

  describe('as respostas', () => {
    it('o nome fantasia vence a razão social', () => {
      const answers = quoteAnswers(fonte());
      expect(resposta(answers, 'identificacao', 'cliente')?.value).toBe(
        'Padaria Aurora',
      );
    });

    it('sem nome fantasia, vale a razão social', () => {
      const answers = quoteAnswers(
        fonte({ customer: { legalName: 'Padaria Aurora LTDA' } }),
      );
      expect(resposta(answers, 'identificacao', 'cliente')?.value).toBe(
        'Padaria Aurora LTDA',
      );
    });

    /** Fantasia em branco não é fantasia: cairia como cliente vazio. */
    it('nome fantasia vazio não apaga o cliente', () => {
      const answers = quoteAnswers(
        fonte({
          customer: { legalName: 'Padaria Aurora LTDA', tradeName: '   ' },
        }),
      );
      expect(resposta(answers, 'identificacao', 'cliente')?.value).toBe(
        'Padaria Aurora LTDA',
      );
    });

    /**
     * O valor viaja com a unidade.
     *
     * É a unidade que faz o Financeiro reconhecer dinheiro — ele procura um campo
     * numérico cuja unidade é código de moeda, não um campo chamado "valor".
     */
    it('o valor total viaja com BRL', () => {
      const total = quoteAnswers(fonte()).find(
        (a) => a.fieldId === 'valor_total',
      );
      expect(total?.value).toBe('1850.50');
      expect(total?.unit).toBe('BRL');
    });

    /** Só o dinheiro leva unidade: um texto com unidade confundiria o compositor. */
    it('nenhum campo de texto leva unidade', () => {
      for (const answer of quoteAnswers(fonte({ notes: 'Observação' }))) {
        if (answer.fieldId !== 'valor_total') {
          expect(answer.unit).toBeUndefined();
        }
      }
    });

    it('a validade entra como data civil', () => {
      const answers = quoteAnswers(
        fonte({ validUntil: new Date('2026-04-30T00:00:00.000Z') }),
      );
      expect(resposta(answers, 'condicoes', 'validade')?.value).toBe(
        '2026-04-30',
      );
    });

    it('a data do documento é o envio quando houve envio', () => {
      const answers = quoteAnswers(
        fonte({ issuedAt: new Date('2026-03-20T15:00:00.000Z') }),
      );
      expect(resposta(answers, 'identificacao', 'data')?.value).toBe(
        '2026-03-20',
      );
    });

    /** O texto de abertura antecede o título: é o parágrafo que apresenta a proposta. */
    it('o objeto junta a abertura e o título, nessa ordem', () => {
      const answers = quoteAnswers(
        fonte({ introText: 'Conforme visita técnica de 10/03.' }),
      );
      expect(resposta(answers, 'escopo', 'objeto')?.value).toBe(
        'Conforme visita técnica de 10/03.\n\nManutenção preventiva dos splits',
      );
    });

    it('sem abertura, o objeto é o título', () => {
      expect(resposta(quoteAnswers(fonte()), 'escopo', 'objeto')?.value).toBe(
        'Manutenção preventiva dos splits',
      );
    });

    /**
     * A ressalva e o motivo do desconto vão para "Não incluso".
     *
     * São o texto que o cliente precisa ler junto do preço, e o modelo não tem
     * campo próprio para nenhum dos dois. Perdê-los faria o documento emitido
     * dizer menos que a proposta na tela.
     */
    it('observação e motivo do desconto entram em Não incluso', () => {
      const answers = quoteAnswers(
        fonte({
          notes: 'Não inclui material elétrico.',
          discountReason: 'Desconto de cliente recorrente.',
        }),
      );
      expect(resposta(answers, 'escopo', 'exclusoes')?.value).toBe(
        'Não inclui material elétrico.\n\nDesconto de cliente recorrente.',
      );
    });

    /** Campo vazio é omitido: gravar em branco imprimiria um rótulo sem nada. */
    it('não grava campo vazio', () => {
      const answers = quoteAnswers(fonte());
      const ids = answers.map((a) => a.fieldId);
      expect(ids).not.toContain('exclusoes');
      expect(ids).not.toContain('validade');
      expect(ids).not.toContain('contato');
      expect(ids).not.toContain('endereco');
      expect(ids).not.toContain('documento');
    });

    it('toda resposta tem seção, campo e valor não vazio', () => {
      const answers = quoteAnswers(
        fonte({
          notes: 'Ressalva',
          validUntil: new Date('2026-04-30T00:00:00.000Z'),
          responsibleName: 'Ana Souza',
          address: {
            street: 'Rua A',
            number: '1',
            city: 'Recife',
            stateCode: 'PE',
          },
          customer: {
            legalName: 'Padaria Aurora LTDA',
            documentType: 'CNPJ',
            documentNumber: '12.345.678/0001-90',
          },
          items: [
            {
              description: 'Serviço',
              unit: 'UN',
              quantity: decimal('1'),
              unitPrice: decimal('10'),
              total: decimal('10'),
            },
          ],
        }),
      );
      expect(answers.length).toBeGreaterThan(0);
      for (const answer of answers) {
        expect(answer.sectionId).toBeTruthy();
        expect(answer.fieldId).toBeTruthy();
        expect(answer.value.length).toBeGreaterThan(0);
      }
    });
  });
});
