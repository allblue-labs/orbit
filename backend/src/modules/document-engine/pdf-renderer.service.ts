import { documentValue } from '../../common/document-value';
import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type {
  DocumentColumn,
  DocumentSection,
  RenderDocumentInput,
} from './document-engine.types';

@Injectable()
export class PdfRendererService {
  render(input: RenderDocumentInput): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const settings = input.settings;
      const document = new PDFDocument({
        size: settings.pageSize ?? 'A4',
        layout: settings.orientation ?? 'portrait',
        margin: settings.margin ?? 48,
        bufferPages: true,
        info: {
          Title: input.title,
          Subject: input.code,
          Creator: 'Orbit Document Engine',
        },
      });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));

      this.header(document, input);
      for (const section of [...input.sections].sort(
        (left, right) => left.order - right.order,
      )) {
        this.section(document, section, input.data);
      }
      this.signatures(document, input);
      this.footer(document, input);
      document.end();
    });
  }

  private header(document: PDFKit.PDFDocument, input: RenderDocumentInput) {
    document
      .font('Helvetica-Bold')
      .fontSize(20)
      .fillColor('#17213a')
      .text(input.title);
    document
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#59657d')
      .text(`${input.code}  •  versão ${input.version}`);
    if (input.settings.header) {
      document
        .moveDown(0.5)
        .text(this.interpolate(input.settings.header, input.data));
    }
    document
      .moveDown()
      .strokeColor('#dce2ec')
      .moveTo(48, document.y)
      .lineTo(547, document.y)
      .stroke();
    document.moveDown();
  }

  private section(
    document: PDFKit.PDFDocument,
    section: DocumentSection,
    data: Record<string, unknown>,
  ) {
    if (section.type === 'PAGE_BREAK') {
      document.addPage();
      return;
    }
    this.ensureSpace(document, 90);
    document
      .font('Helvetica-Bold')
      .fontSize(section.type === 'HEADING' ? 16 : 12)
      .fillColor('#17213a')
      .text(this.interpolate(section.title, data));
    document.moveDown(0.4);
    if (section.type === 'TEXT' || section.type === 'HEADING') {
      document
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#30394b')
        .text(this.interpolate(section.content ?? '', data), {
          lineGap: 3,
        });
    } else if (section.type === 'KEY_VALUE') {
      for (const field of section.fields ?? []) {
        document
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#59657d')
          .text(`${field.label}: `, { continued: true })
          .font('Helvetica')
          .fillColor('#17213a')
          .text(this.value(this.atPath(data, field.path)));
      }
    } else if (section.type === 'TABLE') {
      this.table(
        document,
        section.columns ?? [],
        this.atPath(data, section.dataPath ?? ''),
      );
    }
    document.moveDown();
  }

  private table(
    document: PDFKit.PDFDocument,
    columns: DocumentColumn[],
    value: unknown,
  ) {
    const rows = Array.isArray(value) ? value : [];
    if (columns.length === 0) return;
    const width = 499 / columns.length;
    document.font('Helvetica-Bold').fontSize(8).fillColor('#17213a');
    columns.forEach((column, index) =>
      document.text(column.label, 48 + index * width, document.y, {
        width: column.width ?? width,
        continued: index < columns.length - 1,
      }),
    );
    document.moveDown(0.7);
    for (const row of rows) {
      this.ensureSpace(document, 28);
      const y = document.y;
      document.font('Helvetica').fontSize(8).fillColor('#30394b');
      columns.forEach((column, index) =>
        document.text(
          this.value(this.atPath(row, column.path)),
          48 + index * width,
          y,
          { width: column.width ?? width },
        ),
      );
      document.y = Math.max(document.y, y + 18);
    }
  }

  private signatures(document: PDFKit.PDFDocument, input: RenderDocumentInput) {
    if (input.signatureSlots.length === 0) return;
    document.addPage();
    document
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#17213a')
      .text('Assinaturas');
    document.moveDown();
    for (const slot of [...input.signatureSlots].sort(
      (left, right) => left.order - right.order,
    )) {
      const signature = input.signatures.find(
        (item) => item.slotKey === slot.key,
      );
      document.font('Helvetica-Bold').fontSize(10).text(slot.label);
      document
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#59657d')
        .text(
          signature
            ? `${signature.signerName} • ${signature.signedAt.toISOString()}`
            : slot.required
              ? 'Assinatura obrigatória pendente'
              : 'Assinatura opcional pendente',
        );
      if (signature) {
        document
          .font('Courier')
          .fontSize(7)
          .text(`Hash: ${signature.signatureHash}`);
      }
      document.moveDown();
    }
    document
      .font('Courier')
      .fontSize(7)
      .fillColor('#59657d')
      .text(`Hash do conteúdo: ${input.contentHash}`);
  }

  private footer(document: PDFKit.PDFDocument, input: RenderDocumentInput) {
    const pages = document.bufferedPageRange();
    for (
      let index = pages.start;
      index < pages.start + pages.count;
      index += 1
    ) {
      document.switchToPage(index);
      const footer = input.settings.footer
        ? this.interpolate(input.settings.footer, input.data)
        : 'Gerado pelo Orbit Document Engine';
      document
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#78849a')
        .text(
          input.settings.showPageNumbers === false
            ? footer
            : `${footer}  •  página ${index + 1} de ${pages.count}`,
          48,
          document.page.height - 34,
          { width: document.page.width - 96, align: 'center' },
        );
    }
  }

  private ensureSpace(document: PDFKit.PDFDocument, height: number) {
    if (document.y + height > document.page.height - 60) document.addPage();
  }

  private interpolate(template: string, data: Record<string, unknown>) {
    return template.replace(
      /\{\{\s*([\w.-]+)\s*\}\}/g,
      (_match, path: string) => this.value(this.atPath(data, path)),
    );
  }

  private atPath(value: unknown, path: string): unknown {
    if (!path) return value;
    return path.split('.').reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[key];
    }, value);
  }

  private value(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') return documentValue(value);
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    return '—';
  }
}
