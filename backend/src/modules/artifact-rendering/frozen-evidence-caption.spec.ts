/**
 * A legenda de cada foto no documento congelado.
 *
 * ## O que este teste protege
 *
 * `photoGrid` imprime uma legenda sob cada imagem do registro fotográfico, e o
 * que chegava ali era o rótulo da **categoria**: três fotos de "Depois" saíam
 * com "Depois" escrito embaixo das três. A legenda ocupava espaço na folha e
 * não dizia nada.
 *
 * O elo é uma linha no montador. Ele quebra em silêncio: o aplicativo continua
 * gravando a legenda no snapshot e o compositor continua desenhando o que
 * recebe — só a junção erra, que é o caminho de produção.
 */
import { ArtifactRenderAssembler } from './artifact-render.assembler';

const assembler = new ArtifactRenderAssembler();

function montar(evidence: readonly Record<string, unknown>[]) {
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
      metadata: {},
      sections: [],
      signatureSlots: [],
      layout: {},
    },
    frozen: { snapshotHash: 'b'.repeat(64), evidence },
    assets: new Map(),
    organizationName: 'Orbit',
    correlationId: 'corr-1',
  });
}

const foto = (extra: Record<string, unknown>) => ({
  id: 'ev-1',
  storageFileId: 'file-1',
  category: 'AFTER',
  fileName: 'depois.jpg',
  mimeType: 'image/jpeg',
  sha256: 'c'.repeat(64),
  ...extra,
});

describe('legenda do registro fotográfico', () => {
  it('imprime o que o técnico escreveu', () => {
    const { evidence = [] } = montar([
      foto({ caption: 'Evaporadora após limpeza química' }),
    ]);

    expect(evidence[0]!.caption).toBe('Evaporadora após limpeza química');
  });

  /**
   * Snapshot anterior à coluna não tem o campo, e continua imprimindo o rótulo.
   *
   * Sem este fallback, um documento emitido antes da legenda existir passaria a
   * sair com a legenda em branco — mudando um documento já entregue.
   */
  it('sem legenda, cai no rótulo da categoria', () => {
    const { evidence = [] } = montar([foto({})]);

    expect(evidence[0]!.caption).toBe('Depois do atendimento');
  });

  it('legenda em branco é o mesmo que não legendar', () => {
    const { evidence = [] } = montar([foto({ caption: '   ' })]);

    expect(evidence[0]!.caption).toBe('Depois do atendimento');
  });

  /** `kind` continua sendo a categoria: são duas informações diferentes. */
  it('a categoria continua publicada à parte da legenda', () => {
    const { evidence = [] } = montar([foto({ caption: 'Dreno desobstruído' })]);

    expect(evidence[0]!.kind).toBe('Depois do atendimento');
    expect(evidence[0]!.caption).toBe('Dreno desobstruído');
  });

  /** Cada foto com a sua: era justamente o que a legenda por categoria perdia. */
  it('cada foto carrega a sua legenda', () => {
    const { evidence = [] } = montar([
      foto({ id: 'ev-1', caption: 'Filtro saturado' }),
      foto({ id: 'ev-2', caption: 'Serpentina oxidada' }),
    ]);

    expect(evidence.map((item) => item.caption)).toEqual([
      'Filtro saturado',
      'Serpentina oxidada',
    ]);
  });
});
