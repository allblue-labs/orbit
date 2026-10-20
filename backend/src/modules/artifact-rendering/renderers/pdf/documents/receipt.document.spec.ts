/**
 * O recibo premium.
 *
 * É o único documento da série que prova um fato jurídico, então o que se
 * testa é o que o invalidaria: a declaração divergindo do cartão, o valor
 * saindo como `NaN`, o extenso faltando, e o código de papel do banco
 * impresso ao lado da assinatura.
 */
import { ArtifactPremiumPdfRenderer } from '../artifact-premium-pdf.renderer';
import type { RenderInput } from '../../artifact-renderer';
import { pdfText } from '../../../../../../test/support/pdf-text';

function entrada(
  options: {
    valor?: unknown;
    referente?: string;
    garantia?: unknown;
    semData?: boolean;
  } = {},
): RenderInput {
  return {
    execution: {
      id: 'exec-rec',
      code: 'REC-000076',
      title: 'Recibo de pagamento',
      status: 'COMPLETED',
    },
    snapshot: {
      id: 'snap-rec',
      templateKey: 'ORBIT_RECIBO',
      templateName: 'Recibo',
      templateVersion: 2,
      artifactType: 'RECIBO',
      structureHash: 'h',
    },
    sections: [
      {
        id: 'partes',
        title: 'Partes',
        order: 1,
        type: 'FORM',
        fields: [
          {
            id: 'pagador',
            label: 'Recebemos de',
            type: 'TEXT',
            order: 1,
            required: true,
            hidden: false,
            value: 'Fictícia System Ltda',
          },
          {
            id: 'documento_pagador',
            label: 'CNPJ ou CPF',
            type: 'TEXT',
            order: 2,
            required: false,
            hidden: false,
            value: 'CNPJ 12.121.212/1212-12',
          },
          ...(options.semData
            ? []
            : [
                {
                  id: 'data',
                  label: 'Data',
                  type: 'DATE',
                  order: 3,
                  required: true,
                  hidden: false,
                  value: '2026-09-16',
                },
              ]),
        ],
      },
      {
        id: 'valor',
        title: 'Valor',
        order: 2,
        type: 'FORM',
        fields: [
          {
            id: 'valor',
            label: 'Valor recebido',
            type: 'DECIMAL',
            order: 1,
            required: true,
            hidden: false,
            value: options.valor ?? '1234.56',
            unit: 'BRL',
          },
          {
            id: 'referente',
            label: 'Referente a',
            type: 'LONG_TEXT',
            order: 2,
            required: true,
            hidden: false,
            value:
              options.referente ?? 'Manutenção corretiva conforme OS-000072.',
          },
          ...(options.garantia === undefined
            ? []
            : [
                {
                  id: 'garantia_dias',
                  label: 'Garantia (dias)',
                  type: 'NUMBER',
                  order: 3,
                  required: false,
                  hidden: false,
                  value: options.garantia,
                },
              ]),
        ],
      },
    ],
    signatures: [
      {
        slotId: 'recebedor',
        label: 'Quem recebeu',
        signerRole: 'ISSUER',
        required: true,
        order: 1,
        signerName: 'Helena Braga',
        signedAt: '2026-09-16T18:00:00.000Z',
      },
    ],
    branding: { primaryColor: '#1B4DB1' },
    layout: {},
    metadata: {
      documentContext: {
        emitter: { tradeName: 'Clima Norte' },
        customer: { name: 'Fictícia System' },
        operation: { code: 'OP-000080' },
      },
    },
    correlationId: 'corr-rec',
    generatedAt: new Date('2026-09-16T18:05:00.000Z'),
  };
}

describe('Recibo premium', () => {
  const renderer = new ArtifactPremiumPdfRenderer();

  it('imprime o valor em número e por extenso', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('VALOR RECEBIDO');
    expect(texto).toContain('1.234,56');
    /* O extenso é a defesa contra adulteração do número, e precisa estar nos
       dois lugares: no bloco de destaque, conferindo o número ao lado, e na
       declaração de quitação. Contar as ocorrências é o que distingue os dois
       — afirmar só a presença passaria com o bloco mudo. */
    const extenso = texto.match(
      /mil duzentos e trinta e quatro reais e cinquenta e seis centavos/g,
    );
    expect(extenso).toHaveLength(2);
  });

  it('lê o decimal tanto como texto quanto como número', async () => {
    const comoTexto = pdfText(
      (await renderer.render(entrada({ valor: 'R$ 1.234,56' }))).bytes,
    );
    const comoNumero = pdfText(
      (await renderer.render(entrada({ valor: 1234.56 }))).bytes,
    );

    for (const texto of [comoTexto, comoNumero]) {
      expect(texto).toContain('1.234,56');
      expect(texto).toContain('cinquenta e seis centavos');
    }
  });

  it('omite o valor em vez de imprimir NaN', async () => {
    /* `'-'` sobrevive à limpeza de caracteres e vira `Number('-')`, que é
       `NaN`: é o que exercita a guarda, e não um texto que a limpeza já
       descarta antes. */
    const texto = pdfText(
      (await renderer.render(entrada({ valor: '-' }))).bytes,
    );

    /* "R$ NaN" parece um valor, e um recibo com valor ilegível é pior que um
       recibo sem o bloco. */
    expect(texto).not.toContain('NaN');
    expect(texto).not.toContain('VALOR RECEBIDO');
    /* A quitação continua valendo mesmo sem o número. */
    expect(texto).toContain('Declaração de quitação');
  });

  it('monta a declaração a partir dos mesmos campos do cartão', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Recebemos de Fictícia System Ltda');
    expect(texto).toContain('CNPJ 12.121.212/1212-12');
    expect(texto).toContain('dando plena, geral e irrevogável quitação');
  });

  it('não deixa ponto no meio da oração costurada', async () => {
    const texto = pdfText(
      (await renderer.render(entrada({ referente: 'Serviços prestados.' })))
        .bytes,
    );

    expect(texto).toContain('referente a serviços prestados, dando plena');
    expect(texto).not.toContain('prestados., dando');
  });

  it('calcula até quando a garantia vale', async () => {
    const texto = pdfText(
      (await renderer.render(entrada({ garantia: 90 }))).bytes,
    );

    expect(texto).toContain('90 dias');
    expect(texto).toContain('16/09/2026');
    /* Quem lê quer saber até quando; fazer a conta de cabeça a partir de uma
       data e um prazo é onde as divergências nascem. */
    expect(texto).toContain('15/12/2026');
  });

  it('não inventa garantia que ninguém registrou', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).not.toContain('Garantia');
  });

  it('não vaza o código do papel ao lado da assinatura', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Emitente');
    expect(texto).not.toContain('ISSUER');
  });
});
