import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { PDFDocument as PdfArchive } from 'pdf-lib';
import {
  buildTheme,
  METRICS,
  registerFonts,
} from '../artifact-rendering/renderers/pdf/kit/theme';
import {
  sectionTitle,
  noteBlock,
} from '../artifact-rendering/renderers/pdf/kit/blocks';
import { signatureBlock } from '../artifact-rendering/renderers/pdf/kit/media-blocks';

interface CustomerAcceptance {
  code: string;
  signerName: string;
  signedAt: Date;
  originalSha256: string;
  signature: Buffer;
}

/** Mantém todas as páginas da proposta congelada e acrescenta seu aceite. */
@Injectable()
export class QuoteAcceptedDocumentService {
  async render(
    original: Buffer,
    acceptance: CustomerAcceptance,
  ): Promise<Buffer> {
    const receipt = await this.receipt(acceptance);
    const document = await PdfArchive.load(original);
    const appendix = await PdfArchive.load(receipt);
    const pages = await document.copyPages(appendix, appendix.getPageIndices());
    for (const page of pages) document.addPage(page);
    document.setModificationDate(acceptance.signedAt);
    return Buffer.from(await document.save());
  }

  private receipt(acceptance: CustomerAcceptance): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const theme = buildTheme();
      const document = new PDFDocument({
        size: 'A4',
        margin: METRICS.pageMargin,
        info: {
          Title: `Aceite do orçamento ${acceptance.code}`,
          CreationDate: acceptance.signedAt,
          ModDate: acceptance.signedAt,
        },
      });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
      try {
        registerFonts(document);
        sectionTitle(document, `Aceite do orçamento ${acceptance.code}`, theme);
        noteBlock(
          document,
          'O cliente conferiu os itens, valores e condições da proposta nas páginas anteriores e autorizou sua execução por meio da assinatura abaixo.',
          theme,
        );
        document.moveDown(2);
        signatureBlock(
          document,
          [
            {
              label: 'Cliente',
              signerName: acceptance.signerName,
              roleLabel: 'Cliente · Aprovação da proposta',
              image: acceptance.signature,
              imageMimeType: 'image/png',
              signedAtLabel: `${new Intl.DateTimeFormat('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'long',
                timeZone: 'UTC',
              }).format(acceptance.signedAt)} (UTC)`,
            },
          ],
          theme,
        );
        document.moveDown(2);
        sectionTitle(document, 'Integridade da proposta aprovada', theme);
        noteBlock(
          document,
          `Este aceite corresponde ao PDF original apresentado ao cliente. SHA-256: ${acceptance.originalSha256}`,
          theme,
        );
        document.end();
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error('Acceptance render failed'),
        );
      }
    });
  }
}
