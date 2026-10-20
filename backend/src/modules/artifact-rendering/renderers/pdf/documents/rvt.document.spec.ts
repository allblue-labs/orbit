/**
 * O RVT premium, no que dá para afirmar sobre bytes de PDF.
 *
 * A aparência se confere a olho, nas amostras. O que se testa aqui é o que
 * quebra calado e só aparece na folha do cliente: a data em ISO, o título da
 * instância ocupando o lugar do tipo no cabeçalho, a seção residual repetindo
 * um nome que já saiu, e a tabela que vira a página sem repetir o cabeçalho.
 */
import { ArtifactPremiumPdfRenderer } from '../artifact-premium-pdf.renderer';
import type { RenderInput } from '../../artifact-renderer';
import { pdfText, pdfPageCount } from '../../../../../../test/support/pdf-text';

function equipamentos(quantidade: number) {
  return Array.from({ length: quantidade }, (_, indice) => ({
    sector: `Setor ${indice + 1}`,
    name: 'Split Hi-Wall',
    manufacturer: 'LG',
    model: `MOD-${indice}`,
    identifier: `TAG-${indice}`,
    capacity: '12.000 BTU/h',
  }));
}

function entrada(
  options: {
    artifactType?: string;
    equipamentos?: number;
    sections?: RenderInput['sections'];
  } = {},
): RenderInput {
  return {
    execution: {
      id: 'exec-1',
      code: 'RVT-000053',
      /* Sem o nome do tipo dentro dele, de propósito: é o que torna
         observável se o cabeçalho usou o rótulo do tipo ou o da instância. */
      title: 'Contrato Synapse — visita de setembro',
      status: 'COMPLETED',
      completedAt: '2026-09-24T14:23:00.000Z',
    },
    snapshot: {
      id: 'snap-1',
      templateKey: 'ORBIT_RELATORIO_VISITA',
      templateName: 'Relatório de Visita Técnica',
      templateVersion: 3,
      artifactType: options.artifactType ?? 'RELATORIO_VISITA',
      structureHash: 'hash',
    },
    sections: options.sections ?? [
      {
        id: 'visita',
        title: 'Visita',
        order: 1,
        type: 'FORM',
        fields: [
          {
            id: 'motivo',
            label: 'Motivo da visita',
            type: 'LONG_TEXT',
            order: 1,
            required: true,
            hidden: false,
            value: 'Ruído intermitente na recepção.',
          },
          {
            id: 'constatacoes',
            label: 'Constatações',
            type: 'LONG_TEXT',
            order: 2,
            required: true,
            hidden: false,
            value: 'Folga no eixo do ventilador da evaporadora.',
          },
        ],
      },
      {
        id: 'rotina',
        title: 'Rotina semanal',
        order: 2,
        type: 'CHECKLIST',
        fields: [
          {
            id: 'c1',
            label: 'Limpeza de filtro de ar',
            type: 'BOOLEAN',
            order: 1,
            required: false,
            hidden: false,
            value: true,
            notes: 'Filtro da TAG-001 substituído.',
          },
          {
            id: 'c2',
            label: 'Desobstrução do dreno',
            type: 'BOOLEAN',
            order: 2,
            required: false,
            hidden: false,
            value: undefined,
          },
        ],
      },
      {
        id: 'encaminhamentos',
        title: 'Encaminhamentos',
        order: 3,
        type: 'FORM',
        fields: [
          {
            id: 'recomendacoes',
            label: 'Recomendações',
            type: 'LONG_TEXT',
            order: 1,
            required: false,
            hidden: false,
            value: 'Substituir o mancal em 15 dias.',
          },
          {
            id: 'proxima_visita',
            label: 'Próxima visita sugerida',
            type: 'DATE',
            order: 2,
            required: false,
            hidden: false,
            value: '2026-10-01',
          },
          {
            id: 'pressao',
            label: 'Pressão de sucção',
            type: 'NUMBER',
            order: 3,
            required: false,
            hidden: false,
            value: 68,
            unit: 'psi',
          },
        ],
      },
    ],
    signatures: [
      {
        slotId: 'tecnico',
        label: 'Responsável técnico',
        signerRole: 'TECHNICAL_RESPONSIBLE',
        required: true,
        order: 1,
        signerName: 'Helena Braga',
        professionalCredential: 'CREA-PE 1234543434',
        signedAt: '2026-09-24T14:23:00.000Z',
      },
    ],
    branding: { primaryColor: '#1B4DB1' },
    layout: {},
    metadata: {
      documentContext: {
        emitter: { tradeName: 'Clima Norte' },
        customer: {
          name: 'Synapse Tecnologia',
          legalName: 'Synapse Serviços Digitais LTDA',
          document: 'CNPJ 12.883.399/2288-02',
        },
        operation: { code: 'OP-000086', fieldTechnician: 'Eduardo Silva' },
        equipment: equipamentos(options.equipamentos ?? 3),
      },
    },
    correlationId: 'corr-1',
    generatedAt: new Date('2026-09-24T17:30:00.000Z'),
  };
}

describe('RVT premium', () => {
  const renderer = new ArtifactPremiumPdfRenderer();

  it('nomeia o documento pelo tipo, não pela instância', async () => {
    const saida = await renderer.render(entrada());
    const texto = pdfText(saida.bytes);

    expect(texto).toContain('Relatório de Visita Técnica');
    /* O contrato continua no documento — mas na identificação, não no
       cabeçalho, onde ocupava duas linhas e empurrava o código. */
    /* O travessão sai em WinAnsi e não sobrevive à leitura em latin1; o que
       importa é que o título da instância continua no documento. */
    expect(texto).toContain('visita de setembro');
    expect(texto).toContain('RVT-000053');
  });

  it('imprime a data da próxima visita em pt-BR, nunca em ISO', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('01/10/2026');
    expect(texto).not.toContain('2026-10-01');
  });

  it('não repete o título de uma seção que já saiu', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    /* "Encaminhamentos" sai uma vez, com as recomendações. O campo que sobra
       do template vai para o bloco residual, com nome próprio. */
    expect(texto.match(/Encaminhamentos/g) ?? []).toHaveLength(1);
    expect(texto).toContain('Outras informações registradas');
    /* O rótulo do cartão sai em caixa alta; o que se afirma é que o campo
       residual aparece, não a caixa em que ele aparece. */
    expect(texto.toUpperCase()).toContain('PRESSÃO DE SUCÇÃO (PSI)');
  });

  it('separa o roteiro das respostas livres', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Serviços executados');
    expect(texto).toContain('Limpeza de filtro de ar');
    /* A observação do item sai junto dele, e não numa coluna quase vazia. */
    expect(texto).toContain('Filtro da TAG-001 substituído.');
  });

  it('imprime motivo, constatações e recomendações em blocos próprios', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('MOTIVO DA VISITA');
    expect(texto).toContain('Constatações');
    expect(texto).toContain('RECOMENDAÇÕES');
    expect(texto).toContain('Substituir o mancal em 15 dias.');
  });

  it('distribui a tabela de equipamentos e repete o cabeçalho', async () => {
    const saida = await renderer.render(entrada({ equipamentos: 70 }));
    const texto = pdfText(saida.bytes);

    expect(pdfPageCount(saida.bytes)).toBeGreaterThan(1);
    /* A legenda é do documento, não de uma célula: em minúscula, acima da
       tabela. Concatenada ao cabeçalho da primeira coluna — que foi o defeito
       — ela estourava a largura reservada para a palavra "Item" e
       desalinhava o cabeçalho inteiro na segunda página. */
    expect(texto).toContain('(continuação)');
    expect(texto).not.toContain('ITEM (');
    expect(texto).toContain('MOD-69');
  });

  it('desenha o mesmo papel para o RVT de campo e o do template', async () => {
    const campo = await renderer.render(entrada({ artifactType: 'RVT' }));
    const template = await renderer.render(entrada());

    const textoCampo = pdfText(campo.bytes);
    expect(textoCampo).toContain('Serviços executados');
    expect(textoCampo).toContain('Relatório de Visita Técnica');
    expect(pdfPageCount(campo.bytes)).toBe(pdfPageCount(template.bytes));
  });

  it('não vaza código de situação do banco', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Concluída');
    expect(texto).not.toContain('COMPLETED');
  });
});
