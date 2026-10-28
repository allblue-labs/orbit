import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import sharp from 'sharp';
import { QuoteDocumentService } from '../artifact-rendering/quote-document.service';
import { QuoteAcceptedDocumentService } from './quote-accepted-document.service';

describe('QuoteAcceptedDocumentService', () => {
  it('preserva as páginas apresentadas ao cliente e acrescenta sua assinatura como imagem', async () => {
    const original = await new QuoteDocumentService().render({
      quote: {
        quote: { code: 'ORC-42', title: 'Proposta apresentada ao cliente' },
        customer: { name: 'Cliente original' },
        items: [
          {
            description: 'Manutenção',
            quantity: 1,
            unitPrice: 250,
            total: 250,
          },
        ],
        totals: { subtotal: 250, discount: 0, total: 250 },
      },
    });
    const signature = await sharp({
      create: { width: 120, height: 40, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
    const signed = await new QuoteAcceptedDocumentService().render(original, {
      code: 'ORC-42',
      signerName: 'João da Conceição',
      signedAt: new Date('2026-10-28T12:00:00Z'),
      originalSha256: 'a'.repeat(64),
      signature,
    });
    const source = await PDFDocument.load(original);
    const result = await PDFDocument.load(signed);
    expect(result.getPageCount()).toBe(source.getPageCount() + 1);
    const streams = (pdf: PDFDocument, index: number) => {
      const content = pdf.getPage(index).node.Contents();
      if (!content) throw new Error('Missing page contents');
      return (content instanceof PDFArray ? content.asArray() : [content]).map(
        (entry) => {
          const stream = pdf.context.lookup(entry);
          if (!(stream instanceof PDFRawStream))
            throw new Error('Expected a page stream');
          return Buffer.from(stream.contents);
        },
      );
    };
    for (let index = 0; index < source.getPageCount(); index++)
      expect(streams(result, index)).toEqual(streams(source, index));
    const appendix = result.getPage(result.getPageCount() - 1);
    const images = appendix.node
      .Resources()
      ?.lookup(PDFName.of('XObject'), PDFDict);
    expect(images?.keys().length).toBeGreaterThan(0);
  });
});
