import { PNG } from 'pngjs';
import { ArtifactRenderAssembler } from './artifact-render.assembler';
import { ArtifactPremiumPdfRenderer } from './renderers/pdf/artifact-premium-pdf.renderer';
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
