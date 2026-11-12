import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { generateUuidV7 } from '../../utils';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../storage/storage.types';
@Injectable()
export class DocumentStorageService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
  ) {}
  async store(buffer: Buffer, organizationId: string) {
    const storageKey = `documents/${organizationId}/${Date.now()}-${generateUuidV7()}.pdf`;
    await this.provider.put({
      bucket: this.provider.defaultBucket,
      objectKey: storageKey,
      body: buffer,
      mimeType: 'application/pdf',
    });
    return {
      storageBucket: this.provider.defaultBucket,
      storageKey,
      sizeBytes: BigInt(buffer.length),
      sha256: createHash('sha256').update(buffer).digest('hex'),
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
