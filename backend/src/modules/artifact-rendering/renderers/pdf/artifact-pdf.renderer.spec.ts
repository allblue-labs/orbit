/**
 * Snapshot → PDF.
 *
 * O que dá para afirmar sobre bytes de PDF sem abrir um leitor: que é um PDF
 * válido, que o texto do documento está lá (pdfkit escreve o conteúdo no
 * stream), que a identidade do renderer viaja nos metadados e que documentos
 * diferentes produzem saídas diferentes.
 *
 * Fidelidade visual não é testável assim — e é justamente por isso que o HTML
 * existe primeiro: ele é inspecionável.
 */
import { inflateSync } from 'node:zlib';
import { ArtifactPdfRenderer } from './artifact-pdf.renderer';
import type { RenderInput } from '../artifact-renderer';

/**
 * Texto escrito no PDF.
 *
 * Duas camadas separam a palavra dos bytes: os streams de conteúdo são
 * comprimidos (FlateDecode) e o texto dentro deles é gravado como **hex
 * string** (`<52656c…>`), não como caracteres. Procurar a palavra nos bytes
 * crus não encontraria nada — e passar o teste com uma asserção mais fraca
 * provaria só que o teste desistiu.
 *
 * Descomprimir e decodificar é o que de fato verifica que o conteúdo foi
 * escrito no documento.
 */
function extractText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const parts: string[] = [];
  const streamPattern = /stream\r?\n/g;
  let match: RegExpExecArray | null;

  while ((match = streamPattern.exec(raw)) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end < 0) continue;

    let content: string;
    try {
      content = inflateSync(
        Buffer.from(raw.slice(start, end), 'latin1'),
      ).toString('latin1');
    } catch {
      /** Fontes embutidas não inflam com zlib; não é onde o texto está. */
      continue;
    }

    for (const hex of content.match(/<[0-9a-fA-F]+>/g) ?? []) {
      parts.push(Buffer.from(hex.slice(1, -1), 'hex').toString('latin1'));
    }
  }

  /**
   * Junção sem separador.
   *
   * O ajuste de espaçamento parte uma palavra em vários trechos —
   * `Mar`, `ina Duar`, `te`. Separá-los quebraria justamente a palavra que se
   * quer encontrar.
   */
  return parts.join('');
}

const input = (overrides: Partial<RenderInput> = {}): RenderInput => ({
  execution: {
    id: '019f-exec',
    code: 'OS-2026-002',
    title: 'Relatório técnico',
    status: 'COMPLETED',
    startedAt: null,
    completedAt: null,
  },
  snapshot: {
    id: '019f-snap',
    templateKey: 'ORBIT_RELATORIO_TECNICO',
    templateName: 'Relatório Técnico',
    templateVersion: 1,
    artifactType: 'RELATORIO_TECNICO',
    structureHash: 'c'.repeat(64),
  },
  sections: [
    {
      id: 'analise',
      title: 'Análise',
      order: 1,
      type: 'FORM',
      fields: [
        {
          id: 'conclusao',
          label: 'Conclusão',
          type: 'LONG_TEXT',
          order: 1,
          required: true,
          hidden: false,
          value: 'Equipamento em conformidade',
        },
      ],
    },
  ],
  signatures: [
    {
      slotId: 'rt',
      label: 'Responsável técnico',
      signerRole: 'TECHNICAL_MANAGER',
      required: true,
      order: 1,
      signerName: 'Marina Duarte',
      signerDocument: null,
      signedAt: '2026-08-03T12:00:00.000Z',
      signatureHash: 'd'.repeat(64),
    },
  ],
  branding: { organizationName: 'Allblue Labs' },
  layout: {},
  metadata: {},
  correlationId: '019f-correlation',
  generatedAt: new Date('2026-08-03T12:30:00.000Z'),
  ...overrides,
});

describe('ArtifactPdfRenderer', () => {
  const renderer = new ArtifactPdfRenderer();

  it('produz um PDF válido', async () => {
    const output = await renderer.render(input());

    expect(output.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    /** Todo PDF termina com o marcador de fim de arquivo. */
    expect(output.bytes.subarray(-8).toString()).toContain('%%EOF');
    expect(output.mimeType).toBe('application/pdf');
    expect(output.format).toBe('PDF');
    expect(output.bytes.length).toBeGreaterThan(500);
  });

  it('leva a identidade do renderer nos metadados do arquivo', async () => {
    const output = await renderer.render(input());
    const raw = output.bytes.toString('latin1');

    expect(raw).toContain('pdf.default@1.0.2');
    expect(output.rendererVersion).toBe('1.0.2');
  });

  it('escreve o conteúdo do documento', async () => {
    const text = extractText((await renderer.render(input())).bytes);

    expect(text).toContain('Marina Duarte');
    expect(text).toContain('Conclus');
    expect(text).toContain('OS-2026-002');
    expect(text).toContain('Análise');
  });

  it('publica a contagem do que desenhou', async () => {
    const output = await renderer.render(input());

    expect(output.metadata).toMatchObject({
      sections: 1,
      fields: 1,
      signatures: 1,
      structureHash: 'c'.repeat(64),
    });
  });

  it('documentos diferentes produzem bytes diferentes', async () => {
    const first = await renderer.render(input());
    const second = await renderer.render(
      input({
        execution: { ...input().execution, title: 'Outro documento' },
      }),
    );

    expect(first.bytes.equals(second.bytes)).toBe(false);
  });

  it('não quebra com execução sem seções nem assinaturas', async () => {
    const output = await renderer.render(
      input({ sections: [], signatures: [] }),
    );

    expect(output.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('abre páginas conforme o conteúdo cresce', async () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      id: `secao_${index}`,
      title: `Seção ${index}`,
      order: index + 1,
      type: 'FORM',
      fields: [
        {
          id: `campo_${index}`,
          label: `Campo ${index}`,
          type: 'TEXT',
          order: 1,
          required: false,
          hidden: false,
          value: 'x'.repeat(200),
        },
      ],
    }));

    const output = await renderer.render(input({ sections: many }));
    const pages = (
      output.bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []
    ).length;

    expect(pages).toBeGreaterThan(1);
  });
});
