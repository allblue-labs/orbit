/**
 * Renderer PDF.
 *
 * ## Sobre Chromium/Puppeteer
 *
 * O enunciado pede para avaliar HTML → PDF por Chromium. A avaliação:
 *
 * | Critério                | Chromium/Puppeteer            | pdfkit (adotado)          |
 * | ----------------------- | ----------------------------- | ------------------------- |
 * | Fidelidade ao HTML      | total                         | reimplementa o layout     |
 * | Peso na imagem          | +300 MB e bibliotecas de sistema | zero — já é dependência |
 * | Superfície de ataque    | navegador completo no servidor | biblioteca de desenho     |
 * | Isolamento necessário   | sandbox, limite de memória, timeout | nenhum              |
 * | Já em uso no Orbit      | não                           | sim (`document-engine`)   |
 *
 * A escolha foi **pdfkit**, que já é dependência do projeto e já gera os
 * documentos do Document Engine. Trazer um navegador para o contêiner da API é
 * uma decisão de infraestrutura com custo operacional real — e o valor que ela
 * agrega (fidelidade a CSS complexo) não é necessário para a estrutura destes
 * artefatos, que é tabular.
 *
 * **A troca continua barata**: este renderer é uma implementação de
 * `ArtifactRenderer` registrada no registry. Um `pdf.chromium` que consuma o
 * HTML de `ArtifactHtmlRenderer.document()` entra como provider novo, sem tocar
 * em pipeline, manifest, storage ou API. É por isso que o HTML foi feito
 * primeiro, com quebra lógica de página já marcada no CSS.
 *
 * ## O que este renderer não faz
 *
 * Não interpreta HTML. Ele desenha o **mesmo modelo de documento** que o HTML
 * desenha — as duas saídas vêm de `RenderInput`, não uma da outra.
 */
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type {
  ArtifactRenderer,
  RenderInput,
  RenderOutput,
  RenderSectionInput,
  RenderSignatureInput,
} from '../artifact-renderer';
import { formatAnswer, safeColor } from '../html/html-safe';

const VERSION = '1.0.0';
const MARGIN = 48;
const LABEL_WIDTH = 200;

@Injectable()
export class ArtifactPdfRenderer implements ArtifactRenderer {
  readonly id = 'pdf.default';
  readonly version = VERSION;
  readonly format = 'PDF';
  readonly mimeType = 'application/pdf';

  render(input: RenderInput): Promise<RenderOutput> {
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
        size: 'A4',
        margin: MARGIN,
        bufferPages: true,
        info: {
          Title: input.branding.documentTitle ?? input.execution.title,
          Subject: input.execution.code,
          Creator: 'Orbit Artifact Rendering Engine',
          /**
           * O `producer` carrega a versão do renderer.
           *
           * Um PDF encontrado solto, meses depois, diz quem o produziu sem
           * precisar do manifest ao lado.
           */
          Producer: `${this.id}@${this.version}`,
        },
      });

      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('error', reject);
      document.on('end', () => {
        const bytes = Buffer.concat(chunks);
        resolve({
          bytes,
          mimeType: this.mimeType,
          format: this.format,
          rendererVersion: this.version,
          metadata: {
            sections: input.sections.length,
            fields: input.sections.reduce(
              (total, section) => total + section.fields.length,
              0,
            ),
            signatures: input.signatures.length,
            structureHash: input.snapshot.structureHash,
          },
        });
      });

      try {
        const color = safeColor(input.branding.primaryColor);
        this.header(document, input, color);
        for (const section of [...input.sections].sort(
          (left, right) => left.order - right.order,
        )) {
          this.section(document, section);
        }
        this.evidence(document, input);
        this.signatures(document, input.signatures);
        this.footer(document, input);
        document.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error('PDF render failed'));
      }
    });
  }

  private evidence(document: PDFKit.PDFDocument, input: RenderInput): void {
    if (!input.evidence?.length) return;
    this.ensureSpace(document, 100);
    document
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#1c2333')
      .text('Evidências');
    document.moveDown(0.5);
    for (const item of input.evidence) {
      this.ensureSpace(document, 190);
      if (item.bytes && /^image\/(png|jpeg|jpg)$/i.test(item.mimeType)) {
        document.image(item.bytes, {
          fit: [document.page.width - MARGIN * 2, 150],
          align: 'center',
        });
        document.moveDown(0.3);
      }
      document
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#1c2333')
        .text(item.caption ?? item.fileName);
      document
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#5b6478')
        .text(`${item.fileName} · ${item.kind}`);
      if (item.sha256) document.font('Courier').fontSize(7).text(item.sha256);
      document.moveDown(0.8);
    }
  }

  private header(
    document: PDFKit.PDFDocument,
    input: RenderInput,
    color: string,
  ): void {
    if (input.branding.organizationName) {
      document
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#5b6478')
        .text(input.branding.organizationName);
    }

    document
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor(color)
      .text(input.branding.documentTitle ?? input.execution.title);

    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#5b6478')
      .text(
        `${input.execution.code} · ${input.snapshot.templateName} v${input.snapshot.templateVersion}`,
      );

    if (input.branding.headerText) {
      document.text(input.branding.headerText);
    }

    document.moveDown(1);
  }

  /**
   * Uma seção.
   *
   * A quebra é decidida aqui: se o título não cabe com pelo menos uma linha de
   * conteúdo, a seção começa na página seguinte. É o equivalente físico do
   * `break-inside: avoid` do HTML.
   */
  private section(
    document: PDFKit.PDFDocument,
    section: RenderSectionInput,
  ): void {
    this.ensureSpace(document, 80);

    document
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#1c2333')
      .text(section.title);

    if (section.description) {
      document
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#5b6478')
        .text(section.description);
    }

    document.moveDown(0.3);

    const fields = [...section.fields]
      .filter((field) => !field.hidden)
      .sort((left, right) => left.order - right.order);

    if (fields.length === 0) {
      document
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor('#8a94a8')
        .text('Sem campos preenchidos nesta seção.');
      document.moveDown(0.8);
      return;
    }

    for (const field of fields) {
      this.ensureSpace(document, 32);
      const answered = field.value !== undefined && field.value !== null;
      const value = answered
        ? `${formatAnswer(field.value)}${field.unit ? ` ${field.unit}` : ''}`
        : 'não respondido';

      const top = document.y;
      document
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#3b455c')
        .text(field.label, MARGIN, top, { width: LABEL_WIDTH - 8 });

      const afterLabel = document.y;
      document
        .font(answered ? 'Helvetica' : 'Helvetica-Oblique')
        .fontSize(9)
        .fillColor(answered ? '#1c2333' : '#8a94a8')
        .text(value, MARGIN + LABEL_WIDTH, top, {
          width: document.page.width - MARGIN * 2 - LABEL_WIDTH,
        });

      /** A linha ocupa a altura do lado mais alto — rótulo ou resposta. */
      document.y = Math.max(afterLabel, document.y) + 4;
    }

    document.moveDown(0.8);
  }

  private signatures(
    document: PDFKit.PDFDocument,
    signatures: readonly RenderSignatureInput[],
  ): void {
    if (signatures.length === 0) return;

    this.ensureSpace(document, 120);
    document
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#1c2333')
      .text('Assinaturas');
    document.moveDown(0.5);

    for (const signature of [...signatures].sort(
      (left, right) => left.order - right.order,
    )) {
      this.ensureSpace(document, 90);
      document.moveDown(1.6);

      if (
        signature.signatureImage &&
        /^image\/(png|jpeg|jpg)$/i.test(signature.signatureImageMimeType ?? '')
      ) {
        document.image(signature.signatureImage, { fit: [220, 70] });
        document.moveDown(0.3);
      }

      const width = (document.page.width - MARGIN * 2) * 0.6;
      document
        .moveTo(MARGIN, document.y)
        .lineTo(MARGIN + width, document.y)
        .strokeColor('#1c2333')
        .lineWidth(0.7)
        .stroke();
      document.moveDown(0.3);

      document
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#1c2333')
        .text(`${signature.label} · ${signature.signerRole}`);

      const signed = Boolean(signature.signedAt);
      document
        .font(signed ? 'Helvetica' : 'Helvetica-Oblique')
        .fontSize(9)
        .fillColor(signed ? '#1c2333' : '#8a94a8')
        .text(signed ? (signature.signerName ?? '') : 'aguardando assinatura');

      if (signature.signerDocument) {
        document
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#5b6478')
          .text(signature.signerDocument);
      }
      if (signature.professionalCredential) {
        document
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#5b6478')
          .text(signature.professionalCredential);
      }
      if (signature.signedAt) {
        document
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#5b6478')
          .text(`Assinado em ${signature.signedAt}`);
      }
      if (signature.signatureHash) {
        document
          .font('Courier')
          .fontSize(7)
          .fillColor('#5b6478')
          .text(signature.signatureHash);
      }
    }
  }

  /**
   * Rodapé em todas as páginas.
   *
   * `bufferPages` mantém as páginas abertas até o fim; a numeração só é
   * possível depois de saber quantas existem.
   */
  private footer(document: PDFKit.PDFDocument, input: RenderInput): void {
    const range = document.bufferedPageRange();

    for (let index = 0; index < range.count; index += 1) {
      document.switchToPage(range.start + index);
      const bottom = document.page.height - MARGIN + 8;

      document
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#5b6478')
        .text(
          [
            input.branding.footerText,
            `${input.execution.code} · ${input.snapshot.templateKey} v${input.snapshot.templateVersion}`,
            `gerado em ${input.generatedAt.toISOString()}`,
            `correlação ${input.correlationId}`,
          ]
            .filter(Boolean)
            .join(' · '),
          MARGIN,
          bottom,
          { width: document.page.width - MARGIN * 2, align: 'left' },
        );

      document.text(`${index + 1}/${range.count}`, MARGIN, bottom, {
        width: document.page.width - MARGIN * 2,
        align: 'right',
      });
    }
  }

  /** Abre página nova quando o espaço restante não comporta o bloco. */
  private ensureSpace(document: PDFKit.PDFDocument, needed: number): void {
    const remaining = document.page.height - MARGIN - document.y;
    if (remaining < needed) document.addPage();
  }
}
