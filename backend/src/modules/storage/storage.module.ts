import { StorageUploadGuard } from './storage-upload.guard';
import { StorageCleanupService } from './storage-cleanup.service';
/**
 * Composição do armazenamento.
 *
 * A escolha do provider acontece **aqui e só aqui**. Todo o resto da
 * plataforma recebe `STORAGE_PROVIDER` por injeção e não sabe qual é.
 */
import { Global, Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { PrismaModule } from '../../database/prisma.module';
import { InfrastructureException } from '../../exceptions';
import {
  STORAGE_CONFIG,
  loadStorageConfig,
  type StorageConfig,
} from './storage.config';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.types';
import { LocalFilesystemStorageProvider } from './providers/local-filesystem.storage';
import { S3CompatibleStorageProvider } from './providers/s3-compatible.storage';
import { BrandImageService } from './brand-image.service';
import { ImageOptimizationService } from './image-optimization.service';
import { FileObjectService } from './file-object.service';
import { StorageFileRepository } from './file-object.repository';
import { StorageFileMapper } from './file-object.mapper';
import { StorageObjectController } from './storage-object.controller';

export function createStorageProvider(config: StorageConfig): StorageProvider {
  if (config.provider === 'LOCAL') {
    return new LocalFilesystemStorageProvider(
      config.bucket,
      resolve(config.localRoot),
      config.localPublicBaseUrl,
      config.localSigningSecret,
    );
  }

  if (
    config.provider === 'R2' ||
    config.provider === 'S3' ||
    config.provider === 'MINIO'
  ) {
    if (!config.s3) {
      throw new InfrastructureException('S3 storage configuration is missing');
    }
    return new S3CompatibleStorageProvider(
      config.provider,
      config.bucket,
      config.s3,
    );
  }

  /** `loadStorageConfig` já recusa Azure e GCS; a guarda mantém o tipo total. */
  throw new InfrastructureException(
    `Storage provider "${config.provider}" is not implemented`,
  );
}

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [StorageObjectController],
  providers: [
    { provide: STORAGE_CONFIG, useFactory: loadStorageConfig },
    {
      provide: STORAGE_PROVIDER,
      inject: [STORAGE_CONFIG],
      useFactory: (config: StorageConfig) => createStorageProvider(config),
    },
    StorageFileRepository,
    StorageFileMapper,
    FileObjectService,
    ImageOptimizationService,
    BrandImageService,
    StorageCleanupService,
    StorageUploadGuard,
  ],
  exports: [
    STORAGE_PROVIDER,
    STORAGE_CONFIG,
    FileObjectService,
    ImageOptimizationService,
    BrandImageService,
    StorageCleanupService,
    StorageUploadGuard,
    StorageFileRepository,
    StorageFileMapper,
  ],
})
export class StorageModule {}
