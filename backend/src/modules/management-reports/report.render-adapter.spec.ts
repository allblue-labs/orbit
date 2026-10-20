/**
 * O relatório gerencial sai com o acabamento do resto do sistema.
 *
 * Duas propriedades que ninguém nota olhando o código e que o usuário nota na
 * primeira impressão:
 *
 * 1. **O PDF é o premium.** O relatório saía pelo `pdf.default` — título,
 *    seções, pares rótulo/valor — enquanto todo documento de campo já saía com
 *    timbre e rodapé numerado. O pior acabanento do sistema estava justamente no
 *    papel que vai para uma reunião.
 * 2. **O timbre chega ao renderizador.** O cabeçalho premium lê o emitente de
 *    `metadata.documentContext`. Sem ele o relatório sairia com a moldura da
 *    marca e sem marca nenhuma — o pior dos dois mundos, e passaria por detalhe
 *    estético.
 */
import { RENDERER_BY_FORMAT } from './report.catalog';
import { ReportRenderAdapter } from './report.render-adapter';
import type { ReportSnapshotReadModel } from './report.read-models';

const SNAPSHOT: ReportSnapshotReadModel = {
  schemaVersion: 1,
  type: 'OPERATIONS_PERFORMANCE',
  name: 'Desempenho operacional',
  period: {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-31T23:59:59.000Z',
    timezone: 'America/Recife',
  },
  scope: {
    organizationId: 'org-1',
    businessUnitId: null,
    businessUnitName: 'Matriz',
  },
  parameters: { dateFrom: '2026-01-01', dateTo: '2026-01-31' },
  sections: [
    {
      id: 'operations.volume',
      title: 'Volume',
      metrics: [
        {
          id: 'operations.opened',
          label: 'Abertas',
          value: '12',
          source: 'operations',
          provenance: 'OBSERVED',
        },
      ],
      tables: [],
    },
  ],
  sources: [
    {
      domain: 'OPERATIONS',
      source: 'operations',
      provenance: 'OBSERVED',
      included: true,
    },
  ],
  generatedAt: '2026-02-01T10:00:00.000Z',
};

const EMITENTE = {
  tradeName: 'Clima Norte',
  legalName: 'Clima Norte Serviços de Refrigeração Ltda',
  logo: Buffer.from('png'),
  logoMimeType: 'image/png',
};

function montar(emitter?: typeof EMITENTE) {
  return new ReportRenderAdapter().toRenderInput({
    reportId: 'rep-1',
    snapshot: SNAPSHOT,
    organizationName: 'Matriz',
    correlationId: 'corr-1',
    sourceHash: 'abcdef0123456789',
    ...(emitter ? { emitter } : {}),
  });
}

describe('RENDERER_BY_FORMAT', () => {
  it('desenha o PDF com o motor premium', () => {
    expect(RENDERER_BY_FORMAT.PDF).toBe('pdf.premium');
  });
});

describe('ReportRenderAdapter', () => {
  it('leva o timbre no contexto que o cabeçalho premium lê', () => {
    const metadata = montar(EMITENTE).metadata as {
      documentContext: { emitter: unknown };
    };

    expect(metadata.documentContext.emitter).toEqual(EMITENTE);
  });

  it('sai sem timbre quando a organização não tem unidade, e não quebra', () => {
    const metadata = montar().metadata as {
      documentContext: { emitter: unknown };
    };

    expect(metadata.documentContext.emitter).toBeUndefined();
  });

  it('não pede assinatura de ninguém', () => {
    /* Um relatório gerencial não é declaração de nenhuma pessoa. Slot de
       assinatura vazio convidaria a tratá-lo como documento formal. */
    expect(montar(EMITENTE).signatures).toEqual([]);
  });

  it('identifica o retrato pelo hash da fonte, não pelo id do relatório', () => {
    const input = montar(EMITENTE);

    expect(input.execution.code).toContain('abcdef01');
    expect(input.snapshot.structureHash).toBe('abcdef0123456789');
    expect(input.snapshot.artifactType).toBe('MANAGEMENT_REPORT');
  });
});
