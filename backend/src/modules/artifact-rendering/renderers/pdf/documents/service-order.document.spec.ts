/**
 * A OS premium, no que dá para afirmar sobre bytes de PDF.
 *
 * É o documento mais emitido e o mais contestado, então o que se testa aqui é
 * o que a contestação alcança: a equipe inteira impressa (e não um nome só), a
 * observação junto à solicitação, e os códigos de enum do
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
    for (const [kind, rotulo] of [
      ['INSTALLATION', 'Instalação'],
      ['MAINTENANCE', 'Manutenção'],
      ['INSPECTION', 'Inspeção'],
      ['DELIVERY', 'Entrega'],
      ['OTHER', 'Outro'],
    ]) {
      for (const noFormulario of [false, true]) {
        const input = entrada({ operacao: { kind } });
        const sections = noFormulario
          ? input.sections.map((section, index) =>
              index === 0
                ? {
                    ...section,
                    fields: [
                      ...section.fields,
                      {
                        id: 'tipo_servico',
                        label: 'Tipo de serviço',
                        type: 'SELECT',
                        order: 2,
                        required: false,
                        hidden: false,
                        value: kind,
                      },
                    ],
                  }
                : section,
            )
          : input.sections;
        const pdf = pdfText(
          (await renderer.render({ ...input, sections })).bytes,
        );
        expect(pdf).toContain(rotulo);
        expect(pdf).not.toContain(kind);
      }
    }
  });

  it('separa o que foi pedido do que foi feito', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).toContain('Solicitação do cliente');
    expect(texto).toContain('Unidade do quarto liga e não refrigera.');
    expect(texto).toContain('PROCEDIMENTOS REALIZADOS');
    expect(texto).toContain('MATERIAIS APLICADOS');
  });

  it('põe Observações logo após a solicitação e antes dos equipamentos e da execução', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    const execucao = texto.indexOf('PROCEDIMENTOS REALIZADOS');
    const solicitacao = texto.indexOf(
      'Unidade do quarto liga e não refrigera.',
    );
    const observacoes = texto.indexOf('Observações');
    const equipamentos = texto.indexOf('Equipamentos atendidos');
    const pendencia = texto.indexOf('Isolamento da suíte');
    const aceite = texto.indexOf('Aceite');

    expect(execucao).toBeGreaterThan(-1);
    expect(solicitacao).toBeGreaterThan(-1);
    expect(observacoes).toBeGreaterThan(solicitacao);
    expect(pendencia).toBeGreaterThan(observacoes);
    expect(equipamentos).toBeGreaterThan(pendencia);
    expect(execucao).toBeGreaterThan(equipamentos);
    expect(aceite).toBeGreaterThan(pendencia);
    expect(texto).not.toContain('Pendências e observações');
  });

  it('omite duração e conclusão do atendimento do documento entregue ao cliente', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);

    expect(texto).not.toContain('3 h 15 min');
    expect(texto).not.toContain('DURAÇÃO DO ATENDIMENTO');
    expect(texto).not.toContain('CONCLUSÃO DO ATENDIMENTO');
    expect(texto).not.toContain('ASSUNTO');
  });

  it('mantém as datas úteis sem imprimir a trilha de etapas do sistema', async () => {
    const texto = pdfText((await renderer.render(entrada())).bytes);
    expect(texto).not.toContain('Andamento do atendimento');
    expect(texto).not.toContain('POR QUEM');
    expect(texto).toContain('INÍCIO DO ATENDIMENTO');
    expect(texto).not.toContain('CONCLUSÃO DO ATENDIMENTO');
    expect(texto).toContain('25/09/2026, 09:10');
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
    expect(texto).not.toContain('Andamento do atendimento');
  });
});
