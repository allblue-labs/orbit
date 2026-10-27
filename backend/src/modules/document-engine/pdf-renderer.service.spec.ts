import { pdfText } from '../../../test/support/pdf-text';
import { PdfRendererService } from './pdf-renderer.service';

describe('PdfRendererService', () => {
  it('prints structured answers as readable business information', async () => {
    const bytes = await new PdfRendererService().render({
      title: 'Relatório',
      code: 'RT-002',
      version: 1,
      sections: [
        {
          key: 'equipment',
          title: 'Equipamentos',
          type: 'KEY_VALUE',
          order: 0,
          fields: [{ label: 'Equipamento', path: 'equipment' }],
        },
      ],
      signatureSlots: [],
      settings: { pageSize: 'A4' },
      data: {
        equipment: { id: 'private-id', name: 'Split Freeze', model: 'LG 18K' },
      },
      signatures: [],
      contentHash: 'hash',
    });
    const text = pdfText(bytes);
    expect(text).toContain('Split Freeze');
    expect(text).toContain('LG 18K');
    expect(text).not.toMatch(/private-id|\{"|\[object Object\]/);
  });

  it('renders a valid PDF with versioned document metadata', async () => {
    const renderer = new PdfRendererService();
    const pdf = await renderer.render({
      title: 'Relatório técnico',
      code: 'RT-001',
      version: 2,
      sections: [
        {
          key: 'summary',
          title: 'Resumo',
          type: 'TEXT',
          order: 0,
          content: 'Cliente: {{customer.name}}',
        },
      ],
      signatureSlots: [],
      settings: { pageSize: 'A4', showPageNumbers: true },
      data: { customer: { name: 'Orbit Cliente' } },
      signatures: [],
      contentHash: 'a'.repeat(64),
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(500);
  });
});
