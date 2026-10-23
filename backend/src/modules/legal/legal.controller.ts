import { Controller, Get, Param, StreamableFile } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Public } from '../../decorators';
import { EntityNotFoundException } from '../../exceptions';
import { legalDocument } from './legal-documents';

@Controller('legal/documents')
export class LegalController {
  @Public()
  @Get(':slug')
  document(@Param('slug') slug: string) {
    if (slug !== 'termos' && slug !== 'privacidade')
      throw new EntityNotFoundException('Document');
    return legalDocument(slug);
  }
  @Public()
  @Get(':slug/download')
  async download(@Param('slug') slug: string) {
    const document = this.document(slug);
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: { Title: document.title, Author: document.provider.name },
    });
    const buffer = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });
    pdf.fontSize(21).text(document.title).moveDown();
    pdf
      .fontSize(10)
      .fillColor('#555555')
      .text(`Versão ${document.version} | Vigência: 23/10/2026`);
    pdf.text(`${document.provider.name} | CNPJ ${document.provider.document}`);
    pdf.text(document.provider.location);
    if (document.provider.privacyEmail)
      pdf.text(`Contato: ${document.provider.privacyEmail}`);
    pdf.moveDown().fillColor('#111111');
    for (const section of document.sections) {
      pdf.font('Helvetica-Bold').fontSize(12).text(section.title).moveDown(0.5);
      for (const paragraph of section.paragraphs)
        pdf
          .font('Helvetica')
          .fontSize(10)
          .text(paragraph, { lineGap: 3 })
          .moveDown(0.7);
      pdf.moveDown(0.5);
    }
    pdf.end();
    return new StreamableFile(await buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="orbit-${document.slug}-${document.version}.pdf"`,
    });
  }
}
