/**
 * O PMOC de execução, no que dá para afirmar sobre bytes de PDF.
 *
 * O que se testa aqui é a **contagem de manutenção** — o número que o cliente
 * usa para saber se o contrato está sendo cumprido.
 *
 * ## Por que ela merece teste próprio
 *
 * O documento carregava o número do **ciclo**, que é o mesmo para todos os
 * equipamentos atendidos no mesmo período. Um aparelho que entra no plano no
 * meio da vigência, ou que fica de fora de um ciclo, tem história própria — e o
 * relatório dele saía afirmando "Execução 7" na sua primeira manutenção.
 *
 * Errar isso não quebra nada: sai um PDF bem desenhado com um número errado, e
 * quem confere é o cliente, meses depois, contando os relatórios que guardou.
 */
import { ArtifactPremiumPdfRenderer } from '../artifact-premium-pdf.renderer';
import type { RenderInput } from '../../artifact-renderer';
import { pdfText } from '../../../../../../test/support/pdf-text';

function entrada(maintenance?: {
  sequence?: number;
  total?: number;
}): RenderInput {
  return {
    execution: {
      id: 'exec-1',
      code: 'PMOC-000023',
      title: 'PMOC — Manutenção 3 — Split Cassete 01',
      status: 'COMPLETED',
      completedAt: '2026-09-24T14:23:00.000Z',
    },
    snapshot: {
      id: 'snap-1',
      templateKey: 'ORBIT_PMOC',
      templateName: 'PMOC — Relatório de Execução',
      templateVersion: 2,
      artifactType: 'PMOC',
      structureHash: 'hash',
    },
    sections: [
      {
        id: 'roteiro',
        title: 'Roteiro',
        order: 1,
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
          },
        ],
      },
    ],
    signatures: [],
    evidence: [],
    organizationName: 'Clima Norte',
    correlationId: 'corr-1',
    branding: { primaryColor: '#1B4DB1' },
    metadata: {
      documentContext: {
        emitter: { tradeName: 'Clima Norte' },
        customer: {
          name: 'Edifício Aurora',
          document: 'CNPJ 12.883.399/2288-02',
        },
        plan: { code: 'PMOC-AURORA-001', name: 'Manutenção anual' },
        ...(maintenance ? { maintenance } : {}),
      },
    },
  } as unknown as RenderInput;
}

describe('PMOC de execução — contagem de manutenção', () => {
  const renderer = new ArtifactPremiumPdfRenderer();

  const render = async (maintenance?: { sequence?: number; total?: number }) =>
    pdfText((await renderer.render(entrada(maintenance))).bytes);

  it('imprime a posição e o total previstos pela vigência', async () => {
    const texto = await render({ sequence: 3, total: 12 });

    expect(texto).toContain('3 de 12');
  });

  /*
   * Plano de vigência aberta não tem total.
   *
   * O gerador de cronograma trunca num teto interno de 120 ciclos. Imprimir
   * "3 de 120" afirmaria dez anos de contrato que ninguém assinou.
   */
  it('sem total, imprime só a posição', async () => {
    const texto = await render({ sequence: 3 });

    expect(texto).toContain('MANUTENÇÃO');
    expect(texto).not.toContain('de 120');
    expect(texto).not.toContain('3 de');
  });

  /*
   * Snapshot antigo — anterior a esta contagem existir — continua imprimindo.
   * O campo fica de fora em vez de sair "0", que afirmaria uma manutenção que
   * não aconteceu.
   */
  it('sem a contagem, o campo não aparece e o documento sai', async () => {
    const texto = await render();

    expect(texto).toContain('PMOC-000023');
    expect(texto).not.toContain('MANUTENÇÃO');
  });

  /*
   * A contagem presente mas vazia.
   *
   * Alcançável: `pmocFacts` descarta número não positivo, então um snapshot com
   * `maintenance: { total: 12 }` e sem posição chega aqui exatamente assim. Sem a
   * guarda na posição, sairia "Manutenção de 12" — ou "0 de 12".
   */
  it('com o total e sem a posição, o campo não aparece', async () => {
    const texto = await render({ total: 12 });

    expect(texto).not.toContain('MANUTENÇÃO');
    expect(texto).not.toContain('de 12');
  });

  /*
   * A observação de quem atendeu.
   *
   * A seção existia e lia `metadata.executionNotes`, que nenhum caminho real
   * preenchia — o técnico escrevia o que encontrou e o relatório saía sem. É a
   * substância do atendimento.
   */
  it('imprime a observação de quem atendeu', async () => {
    const base = entrada({ sequence: 1, total: 12 });
    const texto = pdfText(
      (
        await renderer.render({
          ...base,
          metadata: {
            ...base.metadata,
            executionNotes: 'Filtros lavados; dreno desobstruído.',
          },
        })
      ).bytes,
    );

    expect(texto).toContain('Observações e conclusão');
    expect(texto).toContain('Filtros lavados');
  });

  it('sem observação, não imprime a seção vazia', async () => {
    const texto = await render({ sequence: 1, total: 12 });

    expect(texto).not.toContain('Observações e conclusão');
  });

  it('o plano continua identificado ao lado da contagem', async () => {
    const texto = await render({ sequence: 1, total: 4 });

    expect(texto).toContain('PMOC-AURORA-001');
    expect(texto).toContain('1 de 4');
  });
});
