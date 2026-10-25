import { inflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import { PNG } from 'pngjs';
import { ArtifactPdfRenderer } from '../artifact-pdf.renderer';
import type { RenderInput } from '../../artifact-renderer';
import { signatureBlock, type SignatureItem } from './media-blocks';
import { buildTheme, registerFonts } from './theme';

function image(width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  for (let pixel = 0; pixel < png.data.length; pixel += 4) {
    png.data[pixel] = 17;
    png.data[pixel + 1] = 24;
    png.data[pixel + 2] = 39;
    png.data[pixel + 3] = 255;
  }
  return PNG.sync.write(png);
}

// Inspect the actual PDF drawing coordinates, rather than mocking doc.image.
function geometry(pdf: Buffer) {
  const raw = pdf.toString('latin1');
  const streams = [...raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)]
    .map((match) => {
      try {
        return inflateSync(Buffer.from(match[1]!, 'latin1')).toString('latin1');
      } catch {
        return match[1]!;
      }
    })
    .join('\n');
  const n = '(-?[\\d.]+)';
  const images = [
    ...streams.matchAll(
      new RegExp(`${n} 0 0 ${n} ${n} ${n} cm\\s+/I\\d+ Do`, 'g'),
    ),
  ].map((match) => ({
    width: Number(match[1]),
    height: -Number(match[2]),
    x: Number(match[3]),
    bottom: Number(match[4]),
  }));
  const lines = [
    ...streams.matchAll(new RegExp(`${n} ${n} m\\s+${n} ${n} l`, 'g')),
  ]
    .map((match) => ({
      x: Number(match[1]),
      y: Number(match[2]),
      endX: Number(match[3]),
      endY: Number(match[4]),
    }))
    .filter((line) => line.y === line.endY && line.endX > line.x);
  return { images, lines };
}

async function render(signatures: readonly SignatureItem[], pageBreak = false) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  registerFonts(doc);
  if (pageBreak) doc.y = doc.page.height - doc.page.margins.bottom - 20;
  else doc.y = 100;
  const output = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  signatureBlock(doc, signatures, buildTheme());
  doc.end();
  return output;
}

describe('Centralização das assinaturas nos documentos', () => {
  it.each([1, 2, 3, 4])(
    '%i assinatura(s) ficam centradas em suas linhas, com proporções diferentes',
    async (count) => {
      const shapes = [
        [240, 40],
        [40, 180],
        [80, 80],
        [180, 30],
      ] as const;
      const roles = [
        'Cliente',
        'Técnico Operacional',
        'Proprietário',
        'Gestor',
      ];
      const signatures = roles.slice(0, count).map((label, index) => ({
        label,
        signerName: label,
        roleLabel: label,
        image: image(...shapes[index]!),
        imageMimeType: 'image/png',
      }));
      const { images, lines } = geometry(await render(signatures));
      expect(images).toHaveLength(count);
      expect(lines).toHaveLength(count);
      images.forEach((drawn, index) => {
        const line = lines[index]!;
        expect(drawn.x + drawn.width / 2).toBeCloseTo(
          (line.x + line.endX) / 2,
          3,
        );
        expect(drawn.bottom - drawn.height / 2).toBeCloseTo(line.y - 27, 3);
        expect(drawn.width / drawn.height).toBeCloseTo(
          shapes[index]![0] / shapes[index]![1],
          3,
        );
      });
      if (count % 2 === 1) {
        const last = lines.at(-1)!;
        expect((last.x + last.endX) / 2).toBeCloseTo(595.28 / 2, 3);
      }
    },
  );

  it('preserva o alinhamento ao abrir uma página para as assinaturas', async () => {
    const { images, lines } = geometry(
      await render(
        [
          {
            label: 'Cliente',
            image: image(250, 40),
            imageMimeType: 'image/png',
          },
        ],
        true,
      ),
    );
    expect(images[0]!.x + images[0]!.width / 2).toBeCloseTo(
      (lines[0]!.x + lines[0]!.endX) / 2,
      3,
    );
  });

  it('mantém o campo vazio quando a imagem não pode ser lida', async () => {
    const { images, lines } = geometry(
      await render([
        { label: 'Assinatura pendente' },
        {
          label: 'Arquivo ilegível',
          image: Buffer.from('invalid'),
          imageMimeType: 'image/png',
        },
      ]),
    );
    expect(images).toHaveLength(0);
    expect(lines).toHaveLength(2);
  });

  it.each([
    [240, 40],
    [40, 180],
  ])(
    'o PDF genérico centraliza uma imagem de %i × %i',
    async (width, height) => {
      const input: RenderInput = {
        execution: {
          id: 'exec',
          code: 'DOC-1',
          title: 'Documento',
          status: 'COMPLETED',
        },
        snapshot: {
          id: 'snap',
          templateKey: 'CUSTOM',
          templateName: 'Personalizado',
          templateVersion: 1,
          artifactType: 'CUSTOM',
          structureHash: 'hash',
        },
        sections: [],
        signatures: [
          {
            slotId: 'customer',
            label: 'Cliente',
            signerRole: 'CUSTOMER',
            required: true,
            order: 0,
            signerName: 'Cliente',
            signedAt: '2026-10-24T12:00:00Z',
            signatureImage: image(width, height),
            signatureImageMimeType: 'image/png',
          },
        ],
        branding: { organizationName: 'Empresa' },
        layout: {},
        metadata: {},
        correlationId: 'test',
        generatedAt: new Date('2026-10-24T12:00:00Z'),
      };
      const { images, lines } = geometry(
        (await new ArtifactPdfRenderer().render(input)).bytes,
      );
      const line = lines.find(
        (candidate) =>
          Math.abs(candidate.endX - candidate.x - (595.28 - 96) * 0.6) < 0.01,
      )!;
      expect(line).toBeDefined();
      expect(images).toHaveLength(1);
      expect(images[0]!.x + images[0]!.width / 2).toBeCloseTo(
        (line.x + line.endX) / 2,
        3,
      );
    },
  );
});
