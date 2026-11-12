import { StorageCleanupService } from './storage-cleanup.service';
import { Inject, Injectable } from '@nestjs/common';
import { ValidationException } from '../../exceptions';
import {
  readEmbeddedImage,
  type EmbeddedImage,
} from '../../common/embedded-image';
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.types';
import { FileObjectService } from './file-object.service';
import { pdfImage } from './pdf-image';

/** Logos are public, but document renderers only read our own object keys, never tenant-provided URLs. */
@Injectable()
export class BrandImageService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    private readonly files: FileObjectService,
    private readonly garbage: StorageCleanupService,
  ) {}
  async store(
    organizationId: string,
    ownerId: string,
    image: string,
  ): Promise<string> {
    const match =
      /^data:(image\/(?:png|jpeg|webp|heic));base64,([A-Za-z0-9+/=]+)$/.exec(
        image,
      );
    if (!match)
      throw new ValidationException(
        'Envie uma imagem JPEG, PNG, WebP ou HEIC válida.',
      );
    const file = await this.files.store({
      organizationId,
      createdById: null,
      namespace: 'logos',
      body: Buffer.from(match[2]!, 'base64'),
      fileName: 'logo',
      mimeType: match[1]!,
      metadata: { purpose: 'BRAND_LOGO', ownerId },
    });
    return this.config.publicUrl
      ? `${this.config.publicUrl}/${file.objectKey}`
      : `r2-object:${file.objectKey}`;
  }
  async read(value?: string | null): Promise<EmbeddedImage | null> {
    const embedded = readEmbeddedImage(value);
    if (embedded || !value) return embedded;
    const key = this.key(value);
    if (!key) return null;
    const image = await pdfImage(
      await this.storage.get({
        bucket: this.config.publicBucket ?? this.config.bucket,
        objectKey: key,
      }),
      'image/webp',
    );
    return {
      ...image,
      dataUrl: `data:${image.mimeType};base64,${image.bytes.toString('base64')}`,
    };
  }
  async remove(
    value: string | null | undefined,
    organizationId: string,
  ): Promise<void> {
    if (!value) return;
    const key = this.key(value);
    if (!key || !key.startsWith(`logos/${organizationId}/`)) return;
    const bucket = this.config.publicBucket ?? this.config.bucket;
    try {
      await this.files.remove(bucket, key);
    } catch {
      await this.garbage.enqueue(organizationId, bucket, key);
    }
  }
  private key(value: string): string | null {
    const prefix = this.config.publicUrl
      ? `${this.config.publicUrl}/`
      : 'r2-object:';
    if (!value.startsWith(prefix)) return null;
    const key = value.slice(prefix.length);
    return /^logos\/[a-zA-Z0-9-]+\/(?:[a-zA-Z0-9-]+\/)?\d+-[a-zA-Z0-9-]+\.webp$/.test(
      key,
    )
      ? key
      : null;
  }
}
