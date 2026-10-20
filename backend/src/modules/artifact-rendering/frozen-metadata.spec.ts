/**
 * O elo entre o que o campo congelou e o que o documento imprime.
 *
 * ## O que este teste protege
 *
 * Os compositores premium leem alguns fatos por nome, em `metadata` —
 * `executionNotes` é o que alimenta "Observações da execução" na OS e
 * "Observações" na RVT. Num documento congelado, o `metadata` era só o do
 * **template**: as seções existiam, o técnico escrevia, e nada imprimia.
 *
 * O elo é uma linha no montador, e ela quebra em silêncio — os testes do
 * aplicativo continuam passando (o snapshot tem a observação) e os do documento
 * também (recebem `metadata` direto). Só a junção dos dois é que falha, que é
 * exatamente o caminho de produção.
 */
import { ArtifactRenderAssembler } from './artifact-render.assembler';

const assembler = new ArtifactRenderAssembler();

function montar(frozen: Record<string, unknown>) {
  return assembler.assembleFrozen({
    execution: {
      id: 'exec-1',
      code: 'OS-000087',
      title: 'Ordem de Serviço — OS-000087',
      status: 'COMPLETED',
      startedAt: null,
      completedAt: null,
    },
    snapshot: {
      id: 'snap-1',
      templateKey: 'ORDEM_SERVICO',
      templateName: 'Ordem de Serviço',
      templateVersion: 1,
      artifactType: 'SERVICE_ORDER',
      structureHash: 'a'.repeat(64),
      metadata: { legalReference: 'contrato' },
      sections: [],
      signatureSlots: [],
      layout: {},
    },
    frozen,
    assets: new Map(),
    organizationName: 'Orbit',
    correlationId: 'corr-1',
  });
}

describe('metadados de um documento congelado', () => {
  it('a observação da execução chega ao compositor', () => {
    const input = montar({
      snapshotHash: 'b'.repeat(64),
      metadata: { executionNotes: 'Gás recarregado; dreno desobstruído.' },
    });

    expect(input.metadata.executionNotes).toBe(
      'Gás recarregado; dreno desobstruído.',
    );
  });

  it('o que é do template continua chegando', () => {
    /* Os dois convivem: o template descreve o modelo, o congelado descreve o
       atendimento. Substituir um pelo outro perderia metade. */
    const input = montar({
      snapshotHash: 'b'.repeat(64),
      metadata: { executionNotes: 'Observação.' },
    });

    expect(input.metadata.legalReference).toBe('contrato');
    expect(input.metadata.fieldSnapshotHash).toBe('b'.repeat(64));
  });

  it('o fato da execução vence o do template', () => {
    /* Na ordem inversa, um valor de modelo apagaria a observação que o técnico
       escreveu — e é ela que o cliente lê antes de assinar. */
    const input = assembler.assembleFrozen({
      execution: {
        id: 'exec-1',
        code: 'OS-000087',
        title: 'OS',
        status: 'COMPLETED',
        startedAt: null,
        completedAt: null,
      },
      snapshot: {
        id: 'snap-1',
        templateKey: 'ORDEM_SERVICO',
        templateName: 'Ordem de Serviço',
        templateVersion: 1,
        artifactType: 'SERVICE_ORDER',
        structureHash: 'a'.repeat(64),
        metadata: { executionNotes: 'texto do modelo' },
        sections: [],
        signatureSlots: [],
        layout: {},
      },
      frozen: {
        snapshotHash: 'b'.repeat(64),
        metadata: { executionNotes: 'o que o técnico escreveu' },
      },
      assets: new Map(),
      organizationName: 'Orbit',
      correlationId: 'corr-1',
    });

    expect(input.metadata.executionNotes).toBe('o que o técnico escreveu');
  });

  it('documento congelado sem metadados não quebra', () => {
    const input = montar({ snapshotHash: 'b'.repeat(64) });

    expect(input.metadata.executionNotes).toBeUndefined();
    expect(input.metadata.legalReference).toBe('contrato');
  });
});
