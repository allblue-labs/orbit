import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import sharp from 'sharp';

export interface EquipmentQrLabelInput {
  url: string;
  code: string;
  name: string;
  preset: 'SMALL' | 'STANDARD';
  brandingName?: string;
  logoUrl?: string | null;
}

export interface EquipmentQrRenderedLabel {
  bytes: Buffer;
  contentType: 'image/svg+xml' | 'image/png' | 'application/pdf';
  extension: 'svg' | 'png' | 'pdf';
}

const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (character) =>
      ({
        '<': '&lt;',
        '>': '&gt;',
        '&': '&amp;',
        '"': '&quot;',
        "'": '&apos;',
      })[character]!,
  );

@Injectable()
export class EquipmentQrRenderer {
  async render(
    input: EquipmentQrLabelInput,
    format: 'svg' | 'png' | 'pdf',
  ): Promise<EquipmentQrRenderedLabel> {
    const svg = await this.svg(input);
    if (format === 'svg')
      return {
        bytes: Buffer.from(svg),
        contentType: 'image/svg+xml',
        extension: 'svg',
      };
    if (format === 'png')
      return {
        bytes: await sharp(Buffer.from(svg)).png().toBuffer(),
        contentType: 'image/png',
        extension: 'png',
      };
    return {
      bytes: await this.pdf(input),
      contentType: 'application/pdf',
      extension: 'pdf',
    };
  }

  private async svg(input: EquipmentQrLabelInput) {
    const standard = input.preset === 'STANDARD';
    const width = standard ? 520 : 360;
    const height = standard ? 680 : 480;
    const qrSize = standard ? 400 : 280;
    const qrSvg = await QRCode.toString(input.url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: qrSize,
    });
    const qrContent = qrSvg
      .replace(/^<svg[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '');
    const logo = this.safeLogo(input.logoUrl);
    const logoMarkup = logo
      ? `<image x="${width / 2 - 40}" y="20" width="80" height="48" preserveAspectRatio="xMidYMid meet" href="${xml(logo.dataUrl)}"/>`
      : input.brandingName
        ? `<text x="${width / 2}" y="48" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700">${xml(input.brandingName.slice(0, 40))}</text>`
        : '';
    const qrY = logoMarkup ? 76 : 24;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Etiqueta QR do equipamento ${xml(input.code)}">`,
      '<rect width="100%" height="100%" rx="18" fill="#fff" stroke="#18212f" stroke-width="3"/>',
      logoMarkup,
      `<svg x="${(width - qrSize) / 2}" y="${qrY}" width="${qrSize}" height="${qrSize}" viewBox="0 0 ${qrSize} ${qrSize}">${qrContent}</svg>`,
      `<text x="${width / 2}" y="${qrY + qrSize + 38}" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" fill="#435064">Equipamento</text>`,
      `<text x="${width / 2}" y="${qrY + qrSize + 76}" text-anchor="middle" font-family="Arial,sans-serif" font-size="30" font-weight="700" fill="#101828">${xml(input.code)}</text>`,
      `<text x="${width / 2}" y="${qrY + qrSize + 108}" text-anchor="middle" font-family="Arial,sans-serif" font-size="16" fill="#435064">${xml(input.name.slice(0, 48))}</text>`,
      '</svg>',
    ].join('');
  }

  private async pdf(input: EquipmentQrLabelInput): Promise<Buffer> {
    const qr = await QRCode.toBuffer(input.url, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: input.preset === 'STANDARD' ? 720 : 480,
    });
    const size =
      input.preset === 'STANDARD' ? [283.46, 425.2] : [198.43, 283.46];
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({
        size,
        margin: 18,
        info: { Title: `QR ${input.code}` },
      });
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('error', reject);
      document.on('end', () => resolve(Buffer.concat(chunks)));
      const logo = this.safeLogo(input.logoUrl);
      if (logo)
        document.image(logo.bytes, size[0]! / 2 - 34, 18, {
          fit: [68, 36],
          align: 'center',
          valign: 'center',
        });
      else if (input.brandingName)
        document
          .font('Helvetica-Bold')
          .fontSize(11)
          .text(input.brandingName.slice(0, 40), 18, 24, {
            width: size[0]! - 36,
            align: 'center',
          });
      const qrSize = size[0]! - 44;
      document.image(qr, 22, 62, { width: qrSize, height: qrSize });
      document
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#435064')
        .text('Equipamento', 18, 68 + qrSize, {
          width: size[0]! - 36,
          align: 'center',
        });
      document
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor('#101828')
        .text(input.code, 18, 86 + qrSize, {
          width: size[0]! - 36,
          align: 'center',
        });
      document
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#435064')
        .text(input.name.slice(0, 48), 18, 110 + qrSize, {
          width: size[0]! - 36,
          align: 'center',
        });
      document.end();
    });
  }

  /** Only small embedded raster data is accepted; no URL fetch or SVG script. */
  private safeLogo(value?: string | null) {
    if (!value) return null;
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(
      value,
    );
    if (!match) return null;
    const bytes = Buffer.from(match[2]!, 'base64');
    if (!bytes.length || bytes.length > 512_000) return null;
    return { bytes, dataUrl: value };
  }
}
