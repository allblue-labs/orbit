import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { generateUuidV7 } from '../../utils';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../storage/storage.types';
import { ImageOptimizationService } from '../storage/image-optimization.service';
export interface StoredOperationFile {
  storageKey: string;
  checksum: string;
  size: number;
  mimeType: string;
  fileName: string;
}
@Injectable()
export class OperationStorageService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
    private readonly images: ImageOptimizationService,
  ) {}
  async store(
    file: Express.Multer.File,
    organizationId: string,
  ): Promise<StoredOperationFile> {
    const image = file.mimetype.startsWith('image/');
    const body = image
      ? await this.images.optimize(file.buffer, file.mimetype)
      : file.buffer;
    const mimeType = image ? 'image/webp' : file.mimetype;
    const extension = image
      ? '.webp'
      : extname(file.originalname)
          .toLowerCase()
          .replace(/[^.a-z0-9]/g, '')
          .slice(0, 12);
    const storageKey = `attachments/${organizationId}/${Date.now()}-${generateUuidV7()}${extension}`;
    await this.provider.put({
      bucket: this.provider.defaultBucket,
      objectKey: storageKey,
      body,
      mimeType,
    });
    return {
      storageKey,
      checksum: createHash('sha256').update(body).digest('hex'),
      size: body.length,
      mimeType,
      fileName: image
        ? file.originalname.replace(/\.[^.]+$/, '') + '.webp'
        : file.originalname,
    };
  }
  read(storageKey: string) {
    return this.provider.get({
      bucket: this.provider.defaultBucket,
      objectKey: storageKey,
    });
  }
  remove(storageKey: string) {
    return this.provider.remove({
      bucket: this.provider.defaultBucket,
      objectKey: storageKey,
    });
  }
}
