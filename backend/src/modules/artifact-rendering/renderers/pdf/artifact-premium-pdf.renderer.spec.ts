/**
 * O documento premium, no que dá para afirmar sobre bytes de PDF.
 *
 * Fidelidade visual não se testa assim — para isso existe o olho, e as
 * amostras que o desenvolvimento gera. O que **se** testa aqui é o que quebra
 * calado e ninguém percebe até o cliente receber a folha errada: a contagem de
 * páginas, o cabeçalho de tabela que precisa reaparecer, o rodapé numerado e
 * os códigos do banco que não podem vazar impressos.
 */
import { ArtifactPremiumPdfRenderer } from './artifact-premium-pdf.renderer';
import type { RenderInput } from '../artifact-renderer';
import { pdfText, pdfPageCount } from '../../../../../test/support/pdf-text';

function equipamentos(quantidade: number) {
  return Array.from({ length: quantidade }, (_, indice) => ({
    sector: `Setor ${indice + 1}`,
    name: 'Split Hi-Wall',
    manufacturer: 'Carrier',
    model: `MOD-${indice}`,
    capacity: '12 mil BTU',
  }));
}

function entrada(
  options: {
    equipamentos?: number;
    assinaturas?: RenderInput['signatures'];
  } = {},
): RenderInput {
  return {
    execution: {
      id: 'exec-1',
      code: 'PMOC-000023',
      title: 'PMOC — Cliente',
      status: 'COMPLETED',
      startedAt: null,
      completedAt: null,
    },
    snapshot: {
      id: 'snap-1',
      templateKey: 'ORBIT_PMOC',
      templateName: 'PMOC',
      templateVersion: 3,
      artifactType: 'PMOC',
      structureHash: 'hash-1',
    },
    sections: [
      {
        id: 'roteiro',
        title: 'Unidade evaporadora',
        order: 1,
        type: 'CHECKLIST',
        fields: [
          {
            id: 'f1',
            label: 'LIMPEZA DE FILTRO DE AR',
            type: 'BOOLEAN',
            order: 1,
            required: true,
            hidden: false,
            value: true,
          },
        ],
      },
    ],
    signatures: options.assinaturas ?? [],
    evidence: [],
    branding: { documentTitle: 'PMOC', primaryColor: '#1d4ed8' },
    layout: {},
    metadata: {
      documentContext: {
        emitter: {
          tradeName: 'Climatize',
          legalName: 'Climatize Refrigeração LTDA',
          document: 'CNPJ 21.505.237/0001-02',
          phone: '(81) 98789-4836',
        },
        equipment: equipamentos(options.equipamentos ?? 3),
      },
    },
    correlationId: 'corr-1',
    generatedAt: new Date('2026-07-30T13:22:00.000Z'),
  };
}

describe('ArtifactPremiumPdfRenderer', () => {
  it('produz um PDF válido e se identifica nos metadados', async () => {
    const saida = await new ArtifactPremiumPdfRenderer().render(entrada());

    expect(saida.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(saida.format).toBe('PDF');
    expect(saida.rendererVersion).toBe('2.0.0');
    expect(saida.metadata.documentKind).toBe('PMOC');
  });

  it('imprime o timbre de quem emite e o número do documento', async () => {
    const saida = await new ArtifactPremiumPdfRenderer().render(entrada());
    const texto = pdfText(saida.bytes);

    expect(texto).toContain('Climatize');
    expect(texto).toContain('21.505.237/0001-02');
    expect(texto).toContain('PMOC-000023');
  });

  /**
   * A regressão que este teste tranca.
   *
   * O rodapé é escrito **abaixo** da margem de conteúdo — que é o espaço
   * reservado para ele. O pdfkit lê uma escrita além da margem como "acabou a
   * página" e abre outra; como a moldura é pintada em todas, cada rodapé
   * criava uma página, que ganhava rodapé, que criava outra. Um documento de
   * três páginas saía com nove, metade em branco.
   */
  it('não cria páginas ao pintar o rodapé', async () => {
    const saida = await new ArtifactPremiumPdfRenderer().render(
      entrada({ equipamentos: 3 }),
    );
    expect(pdfPageCount(saida.bytes)).toBe(1);
  });

  it('numera as páginas dizendo o total', async () => {
    const curto = await new ArtifactPremiumPdfRenderer().render(
      entrada({ equipamentos: 3 }),
    );
    expect(pdfText(curto.bytes)).toContain('gina 1 de 1');
  });

  /**
   * Uma tabela que não cabe atravessa a página — e o cabeçalho vai junto.
   *
   * Sem isso, a segunda página começa com números soltos e quem recebeu a
   * folha avulsa não sabe de que coluna são. É o defeito clássico do relatório
   * impresso, e só aparece quando o cliente tem parque grande — nunca no
   * exemplo de três equipamentos que se usa para testar à mão.
   */
  it('reparte a tabela e repete o cabeçalho marcando continuação', async () => {
    const saida = await new ArtifactPremiumPdfRenderer().render(
      entrada({ equipamentos: 60 }),
    );
    const texto = pdfText(saida.bytes);

    expect(pdfPageCount(saida.bytes)).toBeGreaterThan(1);
    expect(texto).toMatch(/CONTINUA/i);
    /* O cabeçalho aparece mais de uma vez justamente por ter sido repetido. */
    expect(texto.match(/CAPACIDADE/gi)?.length ?? 0).toBeGreaterThan(1);
    expect(texto).toContain('gina 1 de ');
  });

  /**
   * O documento é lido por quem não conhece o sistema — o cliente, o fiscal.
   * `TECHNICAL_RESPONSIBLE` impresso é vazamento de banco na cara de quem
   * recebe.
   */
  it('traduz o papel do signatário para palavras de produto', async () => {
    const saida = await new ArtifactPremiumPdfRenderer().render(
      entrada({
        assinaturas: [
          {
            slotId: 'rt',
            label: 'Responsável técnico',
            signerRole: 'TECHNICAL_RESPONSIBLE',
            required: true,
            order: 1,
            signerName: 'Daniel Oliveira',
          },
        ],
      }),
    );
    const texto = pdfText(saida.bytes);

    expect(texto).toContain('Daniel Oliveira');
    expect(texto).toContain('Responsável técnico');
    expect(texto).not.toContain('TECHNICAL_RESPONSIBLE');
  });

  /**
   * Um template que a organização inventou não tem compositor próprio — e
   * continua saindo, dentro da mesma moldura, em vez de falhar.
   */
  it('desenha tipo desconhecido pelo caminho genérico', async () => {
    const generico = entrada();
    const saida = await new ArtifactPremiumPdfRenderer().render({
      ...generico,
      snapshot: { ...generico.snapshot, artifactType: 'TEMPLATE_DA_CASA' },
    });

    expect(saida.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfText(saida.bytes)).toContain('Climatize');
  });
});
