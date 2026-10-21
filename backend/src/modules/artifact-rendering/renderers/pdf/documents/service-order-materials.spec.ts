/**
 * Os materiais do atendimento na OS premium.
 *
 * ## O defeito
 *
 * A OS congelada em campo guarda os materiais como **lista**, num campo de id
 * gerado (`materiais_1`) dentro da seção `materiais`. O documento procurava um
 * campo de id `materiais` — que só existe no template preenchido à mão —, então
 * a lista do aplicativo nunca era encontrada e os materiais não saíam.
 *
 * E saíam pelo lugar errado: por não estarem na lista de campos próprios, caíam
 * em "Outras informações registradas" como objeto serializado.
 */
import { ArtifactPremiumPdfRenderer } from '../artifact-premium-pdf.renderer';
import type { RenderInput } from '../../artifact-renderer';
import { pdfText } from '../../../../../../test/support/pdf-text';

const renderer = new ArtifactPremiumPdfRenderer();

function entrada(sections: RenderInput['sections']): RenderInput {
  return {
    execution: {
      id: 'exec-os',
      code: 'OS-000072',
      title: 'Preventiva',
      status: 'COMPLETED',
      completedAt: '2026-09-25T15:25:00.000Z',
    },
    snapshot: {
      id: 'snap-os',
      templateKey: 'ORBIT_ORDEM_SERVICO',
      templateName: 'Ordem de Serviço',
      templateVersion: 5,
      artifactType: 'ORDEM_SERVICO',
      structureHash: 'h',
    },
    sections,
    signatures: [],
    evidence: [],
    branding: { organizationName: 'Orbit', primaryColor: '#0B5FFF' },
    metadata: {},
    correlationId: 'corr-1',
  } as unknown as RenderInput;
}

const secaoDeMateriais = (
  materiais: readonly Record<string, unknown>[],
): RenderInput['sections'] => [
  {
    id: 'materiais',
    title: 'Materiais',
    order: 5,
    type: 'FORM',
    fields: [
      { id: 'materiais_1', label: 'Materiais', order: 1, value: materiais },
    ],
  } as unknown as RenderInput['sections'][number],
];

const texto = async (sections: RenderInput['sections']) =>
  pdfText((await renderer.render(entrada(sections))).bytes);

describe('materiais na ordem de serviço', () => {
  it('imprime a lista registrada em campo', async () => {
    const saida = await texto(
      secaoDeMateriais([
        {
          descricao: 'Gás R-410A',
          quantidade: '1.500',
          unidade: 'KG',
          origem: 'APPLIED',
        },
      ]),
    );

    expect(saida).toContain('Gás R-410A');
    expect(saida).toContain('1.500');
    expect(saida).toContain('KG');
  });

  /**
   * Previsto e aplicado saem distinguidos.
   *
   * É o que o cliente confere: o que foi orçado e o que de fato entrou. Uma
   * lista só, sem a coluna, não responderia a pergunta que motivou a lista.
   */
  it('distingue previsto de aplicado, em português', async () => {
    const saida = await texto(
      secaoDeMateriais([
        {
          descricao: 'Filtro G4',
          quantidade: '2',
          unidade: 'UN',
          origem: 'PLANNED',
        },
        {
          descricao: 'Abraçadeira',
          quantidade: '4',
          unidade: 'UN',
          origem: 'APPLIED',
        },
      ]),
    );

    expect(saida).toContain('Previsto');
    expect(saida).toContain('Aplicado');
    /* O código do enum é do banco; o cliente lê a OS. */
    expect(saida).not.toContain('PLANNED');
    expect(saida).not.toContain('APPLIED');
  });

  /**
   * A lista não reaparece como resíduo.
   *
   * Sem o corte da seção em "Outras informações registradas", a mesma lista
   * saía duas vezes — e a segunda como objeto serializado.
   */
  it('não repete a lista como objeto serializado', async () => {
    const saida = await texto(
      secaoDeMateriais([
        {
          descricao: 'Fita isolante',
          quantidade: '1',
          unidade: 'RL',
          origem: 'APPLIED',
        },
      ]),
    );

    expect(saida).not.toContain('[object Object]');
    expect(saida).not.toContain('Outras informações registradas');
  });

  /**
   * Material sem descrição não vira linha na tabela.
   *
   * A linha sairia com a quantidade e sem dizer de quê — pior do que não sair,
   * porque alguém somaria aquele "9" a algo.
   */
  it('descarta linha sem descrição', async () => {
    const saida = await texto(
      secaoDeMateriais([
        { descricao: '   ', quantidade: '9', unidade: 'UN', origem: 'APPLIED' },
        {
          descricao: 'Filtro G4',
          quantidade: '2',
          unidade: 'UN',
          origem: 'APPLIED',
        },
      ]),
    );

    /* A linha única logo após o cabeçalho da tabela. Asserção sobre a sequência
       e não sobre "contém 02": o texto extraído de um PDF traz lixo binário de
       fonte, e `02` também aparece em "OS-000072". */
    expect(saida).toContain('ORIGEM01Filtro G42UNAplicado');
  });

  /**
   * Texto livre continua saindo.
   *
   * É como o template oficial registra materiais quando alguém preenche a OS à
   * mão, e documentos assim já foram emitidos.
   */
  it('mantém o texto livre do template preenchido à mão', async () => {
    const saida = await texto([
      {
        id: 'execucao',
        title: 'Execução',
        order: 5,
        type: 'FORM',
        fields: [
          {
            id: 'materiais',
            label: 'Materiais',
            order: 1,
            value: 'Dois filtros e meio litro de detergente.',
          },
        ],
      } as unknown as RenderInput['sections'][number],
    ]);

    expect(saida).toContain('Dois filtros e meio litro de detergente.');
  });
});
