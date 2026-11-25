import { PNG } from 'pngjs';
import sharp from 'sharp';
import { ArtifactRenderAssembler } from './artifact-render.assembler';
import { DocumentContextBuilder } from './document-context.builder';
import { RenderInputFactory } from './render-input.factory';
import { ArtifactPremiumPdfRenderer } from './renderers/pdf/artifact-premium-pdf.renderer';
import { brandImageStub } from '../../../test/support/brand-image.stub';
import { pdfText } from '../../../test/support/pdf-text';

function input(withSignature = true) {
  const png = new PNG({ width: 100, height: 50 });
  png.data.fill(80);
  const image = PNG.sync.write(png);
  return new ArtifactRenderAssembler().assembleFrozen({
    execution: {
      id: 'execution',
      code: 'OS-001',
      title: 'Preventiva',
      status: 'COMPLETED',
      startedAt: null,
      completedAt: null,
    },
    snapshot: {
      id: 'snapshot',
      templateKey: 'ORDEM_SERVICO',
      templateName: 'Ordem de serviço',
      templateVersion: 1,
      artifactType: 'SERVICE_ORDER',
      structureHash: 'hash',
      metadata: {},
      sections: [],
      signatureSlots: [],
      layout: {},
    },
    frozen: {
      sections: [
        {
          id: 'atendimento',
          title: 'Atendimento',
          fields: [{ label: 'Título repetido', value: 'Preventiva' }],
        },
        {
          id: 'equipamento',
          title: 'Equipamento',
          fields: [{ label: 'Equipamentos', value: [{ nome: 'Split' }] }],
        },
        {
          id: 'checklist',
          title: 'Roteiro',
          type: 'CHECKLIST',
          fields: [
            {
              id: 'clean',
              label: 'Limpeza do filtro',
              type: 'BOOLEAN',
              value: true,
            },
            {
              id: 'drain',
              label: 'Limpeza do dreno',
              type: 'BOOLEAN',
              value: false,
            },
          ],
        },
      ],
      signatures: [
        {
          slotId: 'field_technician',
          label: 'Técnico em campo',
          signerName: 'Técnica Ana',
          signatureAssetId: 'professional',
        },
      ],
      customerAcknowledgement: {
        signerName: 'Cliente Maria',
        acknowledgedAt: '2026-10-28T14:00:00Z',
        signatureStorageFileId: withSignature ? 'customer' : null,
        signatureSha256: withSignature ? 'customer-hash' : null,
      },
      evidence: [
        {
          id: 'photo',
          storageFileId: 'photo',
          category: 'AFTER',
          caption: 'Filtro após limpeza',
          mimeType: 'image/png',
          fileName: 'filtro.png',
        },
      ],
    },
    assets: new Map(
      ['professional', 'customer', 'photo'].map((id) => [
        id,
        { bytes: image, mimeType: 'image/png', fileName: `${id}.png` },
      ]),
    ),
    organizationName: 'Orbit',
    correlationId: 'test',
    documentContext: {
      equipment: [{ name: 'Split' }],
      operation: { completedAt: '28/10/2026, 11:00', duration: '1 h 20 min' },
    },
  });
}

describe('OS congelada no atendimento mobile', () => {
  it('leva a imagem e a identidade do cliente ao aceite, além da assinatura profissional', () => {
    const document = input();
    expect(document.signatures).toHaveLength(2);
    expect(document.signatures[1]).toMatchObject({
      signerName: 'Cliente Maria',
      label: 'Aceite do cliente',
      signatureHash: 'customer-hash',
    });
    expect(document.signatures[1]!.signatureImage).toBeInstanceOf(Buffer);
    expect(document.evidence?.[0]?.bytes).toBeInstanceOf(Buffer);
    expect(document.sections[2]!.fields.map((field) => field.value)).toEqual([
      true,
      false,
    ]);
  });

  it('imprime fotos, checklist e aceite sem repetir as seções internas ou duração e conclusão', async () => {
    const pdf = await new ArtifactPremiumPdfRenderer().render(input());
    const text = pdfText(pdf.bytes);
    expect(text).toContain('Evidências do atendimento');
    expect(text).toContain('Filtro após limpeza');
    expect(text).toContain('Cliente Maria');
    expect(text).toContain('Técnica Ana');
    expect(text).toContain('Limpeza do filtro');
    expect(text).not.toContain('Outras informações registradas');
    expect(text).not.toContain('Título repetido');
    expect(text).not.toContain('[object Object]');
    expect(text).not.toContain('CONCLUSÃO DO ATENDIMENTO');
    expect(text).not.toContain('DURAÇÃO DO ATENDIMENTO');
    expect(text).not.toContain('1 h 20 min');
    expect(
      (pdf.bytes.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('preserva o aceite nominal quando a assinatura gráfica é opcional e não foi coletada', () => {
    const signature = input(false).signatures[1]!;
    expect(signature.signerName).toBe('Cliente Maria');
    expect(signature.signatureImage).toBeUndefined();
  });
});

describe('Evidências armazenadas como WebP na ordem de serviço', () => {
  it.each(['mobile', 'web'])(
    'incorpora a foto no PDF emitido pelo fluxo %s',
    async (flow) => {
      const photo = await sharp({
        create: {
          width: 117,
          height: 69,
          channels: 3,
          background: '#276384',
        },
      })
        .webp()
        .toBuffer();
      const storage = { get: jest.fn().mockResolvedValue(photo) };
      const factory = new RenderInputFactory(
        new ArtifactRenderAssembler(),
        new DocumentContextBuilder(),
        storage as never,
        brandImageStub(),
      );
      const file = {
        id: 'photo',
        bucket: 'orbit-assets-private',
        objectKey: 'evidence/filter.webp',
        mimeType: 'image/webp',
        status: 'AVAILABLE',
        fileName: 'filter.webp',
      };
      const evidence = {
        id: 'ev-1',
        storageFileId: file.id,
        caption: 'Filtro após limpeza',
        fileName: 'filter.webp',
        mimeType: 'image/webp',
        sha256: 'a'.repeat(64),
        category: 'AFTER',
      };
      const { execution, snapshot } = input();
      const source = {
        ...execution,
        snapshot: {
          ...snapshot,
          sections: [],
          signatureSlots: [],
          metadata: {},
        },
        organization: { displayName: 'Orbit' },
        responses: [],
        signatures: [],
        signatureAssets: [],
        fieldAssets: [file],
        fieldArtifact:
          flow === 'mobile' ? { snapshot: { evidence: [evidence] } } : null,
        operation: {
          fieldEvidence: [
            { ...evidence, mimeType: 'image/jpeg', storageFile: file },
          ],
        },
      } as unknown as Parameters<RenderInputFactory['build']>[0];

      const document = await factory.build(source, 'test');
      expect(document.evidence).toEqual([
        expect.objectContaining({
          mimeType: 'image/png',
          sha256: evidence.sha256,
        }),
      ]);
      expect(storage.get).toHaveBeenCalledTimes(1);
      expect(storage.get).toHaveBeenCalledWith({
        bucket: file.bucket,
        objectKey: file.objectKey,
      });

      const pdf = await new ArtifactPremiumPdfRenderer().render(document);
      expect(pdfText(pdf.bytes)).toContain(evidence.caption);
      const pictures = pdf.bytes
        .toString('latin1')
        .match(/\/Subtype \/Image\b[^>]+/g);
      expect(pictures).toHaveLength(1);
      expect(pictures?.[0]).toMatch(/\/Width 117\s+\/Height 69/);
    },
  );
});
