import { renderPdfInThread, shouldOffloadPdf } from '../../runtime/pdf-thread';
import sharp from 'sharp';
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

/**
 * Os textos da página de aceite. O padrão é o do orçamento; o contrato de PMOC
 * usa a mesma página com as suas palavras — o mesmo papel, assinado do mesmo
 * jeito, para quem recebeu o link e para o owner.
 */
export interface AcceptanceLabels {
  title: string;
  statement: string;
  roleLabel: string;
  integrityTitle: string;
  /** Antes do hash: "Este aceite corresponde ao PDF original…". */
  integrityLead: string;
}

const ORCAMENTO = (code: string): AcceptanceLabels => ({
  title: `Aceite do orçamento ${code}`,
  statement:
    'O cliente conferiu os itens, valores e condições da proposta nas páginas anteriores e autorizou sua execução por meio da assinatura abaixo.',
  roleLabel: 'Cliente · Aprovação da proposta',
  integrityTitle: 'Integridade da proposta aprovada',
  integrityLead:
    'Este aceite corresponde ao PDF original apresentado ao cliente.',
});

export interface CustomerAcceptance {
  code: string;
  signerName: string;
  /** CPF/CNPJ informado por quem assinou, quando há. */
  signerDocument?: string | null;
  signedAt: Date;
  originalSha256: string;
  signature: Buffer;
  labels?: AcceptanceLabels;
}

/** Mantém todas as páginas da proposta congelada e acrescenta seu aceite. */
@Injectable()
export class QuoteAcceptedDocumentService {
  async render(
    original: Buffer,
    acceptance: CustomerAcceptance,
  ): Promise<Buffer> {
    if (shouldOffloadPdf())
      return renderPdfInThread('accepted-quote', original, acceptance);
    const receipt = await this.receipt({
      ...acceptance,
      signature: await sharp(acceptance.signature, {
        limitInputPixels: 4_000_000,
      })
        .png()
        .toBuffer(),
    });
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
        const textos = acceptance.labels ?? ORCAMENTO(acceptance.code);
        sectionTitle(document, textos.title, theme);
        noteBlock(document, textos.statement, theme);
        document.moveDown(2);
        signatureBlock(
          document,
          [
            {
              label: 'Cliente',
              signerName: acceptance.signerDocument
                ? `${acceptance.signerName} · ${acceptance.signerDocument}`
                : acceptance.signerName,
              roleLabel: textos.roleLabel,
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
        sectionTitle(document, textos.integrityTitle, theme);
        noteBlock(
          document,
          `${textos.integrityLead} SHA-256: ${acceptance.originalSha256}`,
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
