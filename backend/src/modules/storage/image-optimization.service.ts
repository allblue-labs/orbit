import { decodeHeic } from './heic-decoder';
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { ValidationException } from '../../exceptions';
import { detectImageMime } from './image-signature';

export const MAX_IMAGE_BYTES = 10_000_000;
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const MAX_PIXELS = 40_000_000;

@Injectable()
export class ImageOptimizationService {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  async optimize(
    body: Buffer,
    mimeType: string,
    small = false,
  ): Promise<Buffer> {
    if (this.active >= 2) {
      if (this.waiting.length >= 16)
        throw new ValidationException(
          'Há muitas imagens sendo processadas. Tente novamente em instantes.',
        );
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else this.active++;
    try {
      return await this.process(body, mimeType, small);
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
  private async process(
    body: Buffer,
    mimeType: string,
    small = false,
  ): Promise<Buffer> {
    if (!body.length || body.length > MAX_IMAGE_BYTES)
      throw new ValidationException(
        'A imagem deve ter até 10 MB.',
        undefined,
        'FILE_TOO_LARGE',
      );
    if (detectImageMime(body) !== mimeType)
      throw new ValidationException(
        'O conteúdo da imagem não corresponde ao formato informado.',
        undefined,
        'FILE_INVALID',
      );
    try {
      let image = sharp(body, {
        limitInputPixels: MAX_PIXELS,
        animated: false,
        failOn: 'warning',
      });
      if (mimeType === 'image/heic') {
        // Sharp's prebuilt libvips does not decode HEVC. The in-memory libheif
        // decoder handles HEIC on Linux/macOS without shell commands or files.
        const decoded = await decodeHeic(body);
        image = sharp(Buffer.from(decoded.data), {
          raw: { width: decoded.width, height: decoded.height, channels: 4 },
          limitInputPixels: MAX_PIXELS,
        });
      }
      const metadata = await image.metadata();
      if ((metadata.pages ?? 1) > 1)
        throw new Error('Animated images are unsupported');
      // rotate applies EXIF orientation; Sharp strips EXIF/GPS by default.
      return await image
        .rotate()
        .resize({
          width: small ? 512 : 1920,
          height: small ? 512 : 1920,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      throw new ValidationException(
        'Não foi possível processar a imagem. Envie JPEG, PNG, WebP ou HEIC válido.',
        undefined,
        'FILE_INVALID',
      );
    }
  }
}
