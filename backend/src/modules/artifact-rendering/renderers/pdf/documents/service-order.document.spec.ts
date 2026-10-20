/**
 * A OS premium, no que dá para afirmar sobre bytes de PDF.
 *
 * É o documento mais emitido e o mais contestado, então o que se testa aqui é
 * o que a contestação alcança: a equipe inteira impressa (e não um nome só), a
 * pendência que precisa ser lida antes da assinatura, e os códigos de enum do
 * banco que não podem chegar ao cliente.
 */
import { ArtifactPremiumPdfRenderer } from '../artifact-premium-pdf.renderer';
import type { RenderInput } from '../../artifact-renderer';
import { pdfText, pdfPageCount } from '../../../../../../test/support/pdf-text';

function entrada(
  options: {
    artifactType?: string;
    equipamentos?: number;
    operacao?: Record<string, unknown>;
    sections?: RenderInput['sections'];
  } = {},
): RenderInput {
  return {
    execution: {
      id: 'exec-os',
      code: 'OS-000072',
      title: 'Ar-condicionado do quarto sem gelar',
      status: 'COMPLETED',
      completedAt: '2026-09-25T15:25:00.000Z',
    },
    snapshot: {
      id: 'snap-os',
      templateKey: 'ORBIT_ORDEM_SERVICO',
      templateName: 'Ordem de Serviço',
      templateVersion: 5,
      artifactType: options.artifactType ?? 'ORDEM_SERVICO',
      structureHash: 'h',
    },
    sections: options.sections ?? [
      {
        id: 'servico',
        title: 'Serviço',
        order: 1,
        type: 'FORM',
        fields: [
          {
            id: 'descricao',
            label: 'Descrição do serviço solicitado',
            type: 'LONG_TEXT',
            order: 1,
            required: true,
            hidden: false,
            value: 'Unidade do quarto liga e não refrigera.',
          },
        ],
      },
      {
        id: 'execucao',
        title: 'Execução',
        order: 2,
        type: 'FORM',
        fields: [
          {
            id: 'procedimentos',
            label: 'Procedimentos realizados',
            type: 'LONG_TEXT',
            order: 1,
            required: true,
            hidden: false,
            value: 'Desobstrução do dreno e recarga de gás.',
          },
          {
            id: 'materiais',
            label: 'Materiais aplicados',
            type: 'LONG_TEXT',
            order: 2,
            required: false,
            hidden: false,
            value: '400 g de R-410A',
          },
          {
            id: 'pendencias',
            label: 'Pendências',
            type: 'LONG_TEXT',
            order: 3,
            required: false,
            hidden: false,
            value: 'Isolamento da suíte deve ser substituído.',
          },
        ],
      },
      {
        id: 'medicoes',
        title: 'Medições',
        order: 3,
        type: 'FORM',
        fields: [
          {
            id: 'garantia',
            label: 'Garantia do serviço até',
            type: 'DATE',
            order: 1,
            required: false,
            hidden: false,
            value: '2026-12-25',
          },
        ],
      },
    ],
    signatures: [
      {
        slotId: 'cliente',
        label: 'Responsável pelo cliente',
        signerRole: 'CUSTOMER',
        required: true,
        order: 1,
        signerName: 'Darlan Simplício',
        signedAt: '2026-09-25T15:25:00.000Z',
      },
    ],
    branding: { primaryColor: '#1B4DB1' },
    layout: {},
    metadata: {
      documentContext: {
        emitter: { tradeName: 'Clima Norte' },
        customer: { name: 'Darlan Simplício', document: 'CPF 892.839.828-38' },
        operation: options.operacao ?? {
          code: 'OP-000072',
          kind: 'CORRECTIVE',
          priority: 'HIGH',
          duration: '3 h 15 min',
          openedAt: '24/09/2026, 19:20',
          startedAt: '25/09/2026, 09:10',
          completedAt: '25/09/2026, 12:25',
          fieldTechnician: 'Eduardo Silva',
          startedBy: 'Eduardo Silva',
          completedBy: 'Eduardo Silva',
          auxiliaryTechnicians: ['Rafael Nunes', 'Tiago Moreira'],
        },
        equipment: Array.from(
          { length: options.equipamentos ?? 2 },
          (_, indice) => ({
            sector: `Ambiente ${indice + 1}`,
            name: 'Split Hi-Wall',
            manufacturer: 'Electrolux',
            model: `EL-${indice}`,
            identifier: `TAG-${indice}`,
            capacity: '12.000 BTU/h',
          }),
        ),
      },
    },
    correlationId: 'corr-os',
    generatedAt: new Date('2026-09-25T18:00:00.000Z'),
  };
}

describe('Ordem de Serviço premium', () => {
  const renderer = new ArtifactPremiumPdfRenderer();

  it('imprime a equipe inteira, e não só o responsável', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Eduardo Silva');
    /* O modelo do setor imprime um nome só; uma equipe de três aparecendo
       como uma é o que gera discussão sobre hora de mão de obra. */
    expect(texto).toContain('Rafael Nunes');
    expect(texto).toContain('Tiago Moreira');
  });

  it('traduz natureza, prioridade e situação para o cliente', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Corretiva');
    expect(texto).toContain('Alta');
    expect(texto).toContain('Concluída');
    for (const codigo of ['CORRECTIVE', 'HIGH', 'COMPLETED']) {
      expect(texto).not.toContain(codigo);
    }
  });

  it('separa o que foi pedido do que foi feito', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Solicitação do cliente');
    expect(texto).toContain('Unidade do quarto liga e não refrigera.');
    expect(texto).toContain('PROCEDIMENTOS REALIZADOS');
    expect(texto).toContain('MATERIAIS APLICADOS');
  });

  it('põe a pendência depois da execução e antes do aceite', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    const execucao = texto.indexOf('PROCEDIMENTOS REALIZADOS');
    const pendencia = texto.indexOf('Isolamento da suíte');
    const aceite = texto.indexOf('Aceite');

    expect(execucao).toBeGreaterThan(-1);
    /* É o último texto que quem assina lê, e é o que agenda o retorno. */
    expect(pendencia).toBeGreaterThan(execucao);
    expect(aceite).toBeGreaterThan(pendencia);
  });

  it('imprime a duração calculada, sem obrigar o leitor a subtrair', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('3 h 15 min');
  });

  it('omite a coluna do autor quando nenhuma etapa tem autor', async () => {
    const comAutor = pdfText((await renderer.render(entrada())).bytes);
    expect(comAutor).toContain('POR QUEM');

    const semAutor = pdfText(
      (
        await renderer.render(
          entrada({
            operacao: {
              code: 'OP-000072',
              openedAt: '24/09/2026, 19:20',
              completedAt: '25/09/2026, 12:25',
            },
          }),
        )
      ).bytes,
    );
    expect(semAutor).toContain('Andamento do atendimento');
    /* Uma coluna inteira de traços ocupa um terço da largura para não dizer
       nada. */
    expect(semAutor).not.toContain('POR QUEM');
  });

  it('imprime a data de garantia em pt-BR, nunca em ISO', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('25/12/2026');
    expect(texto).not.toContain('2026-12-25');
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
    expect(texto).toContain('EL-69');
  });

  /*
   * A observação do técnico, na OS emitida em campo.
   *
   * O bloco lê `metadata.executionNotes` e sempre saiu vazio em produção: o
   * `metadata` de um documento congelado era só o do template. O técnico
   * escrevia no aplicativo, o texto ficava no histórico da operação, e a folha
   * que o cliente assina saía sem a substância do atendimento.
   */
  it('imprime a observação de quem atendeu', async () => {
    const base = entrada();
    const saida = await renderer.render({
      ...base,
      metadata: {
        ...base.metadata,
        executionNotes: 'Gás recarregado; dreno desobstruído.',
      },
    });

    const texto = pdfText(saida.bytes);

    /* Maiúsculas: é como `noteBlock` escreve o título do bloco. Afirmar a forma
       com acento minúsculo passaria de graça no `not.toContain` do teste
       seguinte — e ele deixaria de provar qualquer coisa. */
    expect(texto).toContain('OBSERVAÇÕES DA EXECUÇÃO');
    expect(texto).toContain('dreno desobstruído');
  });

  it('sem observação, o bloco não aparece só com o título', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).not.toContain('OBSERVAÇÕES DA EXECUÇÃO');
  });

  it('desenha o mesmo papel para a OS de campo e a do template', async () => {
    const campo = await renderer.render(
      entrada({ artifactType: 'SERVICE_ORDER' }),
    );

    const texto = pdfText(campo.bytes);
    expect(texto).toContain('Ordem de Serviço');
    expect(texto).toContain('Identificação da ordem de serviço');
    expect(texto).toContain('Andamento do atendimento');
  });
});
