import { ArtifactPremiumPdfRenderer } from './pdf/artifact-premium-pdf.renderer';
import { ArtifactPdfRenderer } from './pdf/artifact-pdf.renderer';
import { ArtifactHtmlRenderer } from './html/artifact-html.renderer';
import { documentContent } from './document-content';
import type { RenderInput } from './artifact-renderer';
import { pdfText } from '../../../../test/support/pdf-text';

const equipment = {
  id: 'private-equipment-id',
  name: 'Split Freeze',
  manufacturer: 'LG',
  model: 'LG 18K',
  location: 'Sala 20',
  identifier: 'EQP-000001',
  serialNumber: '892389d',
};
function input(type = 'PMOC'): RenderInput {
  const context = {
    sourceType: 'PMOC_EQUIPMENT_EXECUTION',
    sourceEntityId: 'private-physical-id',
    plan: {
      id: 'private-plan-id',
      code: 'PMOC-002',
      name: 'Manutenção Corretiva',
    },
    cycle: { id: 'private-cycle-id', dueOn: '2026-11-27', sequenceNumber: 2 },
    maintenance: { total: 12, sequence: 2 },
    performedAt: '2026-10-27T21:55:00.606Z',
    executionNotes: 'Filtro limpo e equipamento testado.',
    customer: { id: 'private-customer-id', name: 'Cliente do PMOC' },
    equipment,
    procedureAnswers: { '0:0': true, '0:1': false },
    fieldTechnician: { id: 'private-user-id', displayName: 'Técnico de campo' },
    auxiliaries: [
      { id: 'private-assistant-id', displayName: 'Auxiliar presente' },
    ],
    technicalResponsible: {
      userId: 'private-rt-id',
      displayName: 'Responsável técnico',
      signature: {
        id: 'private-signature-id',
        sha256: 'private-signature-hash',
        storageObjectId: 'private-storage-id',
      },
      credential: {
        credentialType: 'CREA',
        credentialNumber: '12345',
        credentialRegion: 'PE',
      },
    },
    procedure: { Evaporadora: ['Limpar filtro', 'Verificar dreno'] },
  };
  return {
    execution: {
      id: 'execution',
      code: 'PMOC-EXEC-002',
      title: 'Manutenção do equipamento',
      status: 'COMPLETED',
    },
    snapshot: {
      id: 'snapshot',
      templateKey: 'generated',
      templateName: 'Relatório',
      templateVersion: 1,
      artifactType: type,
      structureHash: 'hash',
    },
    sections: [
      type === 'PMOC'
        ? {
            id: 'pmoc_context',
            title: 'Execução PMOC por equipamento',
            type: 'FORM',
            order: 1,
            fields: Object.entries(context)
              .filter(([key]) => key !== 'procedure')
              .map(([id, value], index) => ({
                id,
                label: id,
                type: 'TEXT',
                order: index,
                required: true,
                hidden: false,
                value,
              })),
          }
        : {
            id: 'informacoes_adicionais',
            title: 'Informações adicionais',
            order: 1,
            type: 'FORM',
            fields: [
              {
                id: 'equipamentos_extra',
                label: 'Equipamentos',
                type: 'TEXT',
                order: 1,
                required: false,
                hidden: false,
                value: [equipment],
              },
              {
                id: 'texto_livre',
                label: 'Recomendação',
                type: 'TEXT',
                order: 2,
                required: false,
                hidden: false,
                value: 'Retorno para inspeção em 48 horas.',
              },
            ],
          },
    ],
    signatures: [],
    evidence: [],
    branding: { organizationName: 'Empresa', primaryColor: '#234567' },
    layout: {},
    metadata: type === 'PMOC' ? context : {},
    correlationId: 'correlation',
    generatedAt: new Date('2026-10-27T22:00:00Z'),
  };
}
const renderers = [
  new ArtifactPremiumPdfRenderer(),
  new ArtifactPdfRenderer(),
  new ArtifactHtmlRenderer(),
];
async function textOf(
  renderer: (typeof renderers)[number],
  source: RenderInput,
) {
  const output = await renderer.render(source);
  return output.format === 'HTML'
    ? output.bytes.toString('utf8')
    : pdfText(output.bytes);
}
describe('generated PMOC context is presented as a maintenance report', () => {
  it.each(renderers)(
    '$id prints human-readable facts and recorded unit checklist answers',
    async (renderer) => {
      const text = await textOf(renderer, input());
      for (const expected of [
        'PMOC-002',
        'Cliente do PMOC',
        'Split Freeze',
        'LG 18K',
        '892389d',
        'Sala 20',
        '2 de 12',
        '27/11/2026',
        '27/10/2026',
        '18:55',
        'Filtro limpo',
        'Limpar filtro',
        'Verificar dreno',
        'Realizado',
        'Não realizado',
        'Auxiliar presente',
        '12345',
      ])
        expect(text).toContain(expected);
      expect(text).not.toMatch(
        /private-|SOURCETYPE|SOURCEENTITYID|PMOC_EQUIPMENT_EXECUTION|procedureAnswers|PROCEDUREANSWERS|\{"|\[object Object\]/,
      );
      expect(text).not.toContain('2026-10-27T21:55');
    },
  );
  it('changes presentation without modifying frozen answers or inventing checklist confirmations', () => {
    const source = input();
    const original = JSON.stringify(source);
    const prepared = documentContent(source);
    expect(JSON.stringify(source)).toBe(original);
    expect(documentContent(prepared)).toEqual(prepared);
    const missing = {
      ...source,
      sections: source.sections.map((section) => ({
        ...section,
        fields: section.fields.filter(
          (field) => field.id !== 'procedureAnswers',
        ),
      })),
      metadata: { ...source.metadata, procedureAnswers: {} },
    };
    expect(
      documentContent(missing)
        .sections.filter((section) => section.type === 'CHECKLIST')
        .flatMap((section) => section.fields)
        .every((field) => field.value === 'Não informado'),
    ).toBe(true);
  });
});

describe.each([
  'SERVICE_ORDER',
  'ORDEM_SERVICO',
  'RVT',
  'RELATORIO_VISITA',
  'RELATORIO_TECNICO',
  'QUALIDADE_AR',
  'RECIBO',
  'CUSTOM_REPORT',
])('%s structured answers in every renderer', (type) => {
  it.each(renderers)(
    '$id keeps equipment information and business notes without JSON',
    async (renderer) => {
      const text = await textOf(renderer, input(type));
      expect(text).toContain('Split Freeze');
      expect(text).toContain('LG 18K');
      expect(text).toContain('892389d');
      expect(text).toContain('Retorno para inspeção em 48 horas.');
      expect(text).not.toMatch(/private-equipment-id|\{"|\[object Object\]/);
    },
  );
});
