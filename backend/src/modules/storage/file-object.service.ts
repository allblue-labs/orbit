import { StorageCleanupService } from './storage-cleanup.service';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Prisma, StorageFile } from '@prisma/client';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { EntityNotFoundException, ValidationException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';
import {
  STORAGE_PROVIDER,
  type SignedUrl,
  type SignedUrlOperation,
  type StorageProvider,
} from './storage.types';
import {
  StorageFileRepository,
  type CreateStorageFileData,
} from './file-object.repository';
import {
  ImageOptimizationService,
  IMAGE_CACHE_CONTROL,
  MAX_IMAGE_BYTES,
} from './image-optimization.service';
import { uploadGrant } from './upload-grant';
import { UPLOAD_LIMITS } from './upload-budget.service';
import { ACCEPTED_IMAGE_MIME_TYPES } from './image-signature';

export const STORAGE_NAMESPACES = {
  manifest: 'manifests',
  attachment: 'attachments',
  report: 'reports',
  signature: 'signatures',
  evidence: 'field-evidence',
  avatar: 'avatars',
  logo: 'logos',
  /** Exportações assíncronas de documento; vencem em 24 h. */
  documentExport: 'document-exports',
} as const;
export type StorageNamespace =
  (typeof STORAGE_NAMESPACES)[keyof typeof STORAGE_NAMESPACES];
export interface StoreObjectInput {
  organizationId: string;
  businessUnitId?: string | null;
  namespace: StorageNamespace;
  fileName: string;
  mimeType: string;
  body: Buffer;
  metadata?: Record<string, unknown>;
  createdById: string | null;
}
export interface ReserveObjectInput extends Omit<
  StoreObjectInput,
  'body' | 'metadata'
> {
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

/** Domain-facing storage service. Canonical bytes, MIME, size and hash are saved together. */
@Injectable()
export class FileObjectService {
  private readonly logger = new Logger(FileObjectService.name);
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    private readonly repository: StorageFileRepository,
    private readonly images: ImageOptimizationService = new ImageOptimizationService(),
    @Optional() private readonly garbage?: StorageCleanupService,
  ) {}
  static hash(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }
  async store(input: StoreObjectInput) {
    return this.storeUsing(input, (data) => this.repository.create(data));
  }
  async storeWith(tx: Prisma.TransactionClient, input: StoreObjectInput) {
    // The caller owns this transaction and must roll it back when create fails.
    return this.storeUsing(
      input,
      (data) => this.repository.createWith(tx, data),
      false,
    );
  }
  private async storeUsing(
    input: StoreObjectInput,
    create: (
      data: CreateStorageFileData,
    ) => ReturnType<StorageFileRepository['create']>,
    ownsCommit = true,
  ) {
    const normalized = await this.normalize(input);
    const objectKey = this.buildObjectKey(normalized);
    const data = this.toData(
      normalized,
      objectKey,
      BigInt(normalized.body.length),
      FileObjectService.hash(normalized.body),
    );
    await this.put(data, normalized.body);
    try {
      return await create(data);
    } catch (error) {
      if (ownsCommit) return this.recoverPublication(data, error);
      await this.cleanup(data.bucket, objectKey);
      throw error;
    }
  }
  async reserve(input: ReserveObjectInput) {
    if (
      ![...ACCEPTED_IMAGE_MIME_TYPES, 'application/pdf'].includes(
        input.mimeType,
      )
    )
      throw new ValidationException(
        'Formato de arquivo não permitido.',
        undefined,
        'FILE_INVALID',
      );
    const image = input.mimeType.startsWith('image/');
    if (
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes <= 0 ||
      input.sizeBytes > (image ? MAX_IMAGE_BYTES : 20_000_000)
    )
      throw new ValidationException(
        image
          ? 'A imagem deve ter até 10 MB.'
          : 'O arquivo deve ter até 20 MB.',
        undefined,
        'FILE_TOO_LARGE',
      );
    const objectKey = this.buildObjectKey(input);
    // Pending originals are never exposed through the public bucket.
    const data = this.toData(input, objectKey, BigInt(input.sizeBytes), null);
    data.bucket = this.config.bucket;
    data.metadata = { ...input.metadata, namespace: input.namespace };
    const file = await this.repository.createReserved(data);
    const signed = uploadGrant(this.config, {
      ...file,
      operation: 'upload',
      expiresInSeconds: this.config.signedUrlTtlSeconds,
    });
    return { file, signed };
  }
  /** The grant must resolve to its original reservation, never a canonical key. */
  async describeUpload(
    organizationId: string,
    bucket: string,
    objectKey: string,
  ) {
    const file = await this.repository.findByRef(
      organizationId,
      bucket,
      objectKey,
    );
    if (
      !file ||
      file.provider !== this.provider.name ||
      !['PENDING', 'AVAILABLE'].includes(file.status)
    )
      throw new EntityNotFoundException('Upload');
    const metadata = (file.metadata ?? {}) as Record<string, unknown>;
    if (
      file.status === 'AVAILABLE' &&
      (metadata.sourceObjectKey !== objectKey ||
        metadata.sourceBucket !== bucket)
    )
      throw new EntityNotFoundException('Upload');
    const sizeBytes =
      file.status === 'PENDING'
        ? Number(file.sizeBytes)
        : metadata.sourceSizeBytes;
    const mimeType =
      file.status === 'PENDING' ? file.mimeType : metadata.sourceMimeType;
    if (
      typeof sizeBytes !== 'number' ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > UPLOAD_LIMITS.maxBytes ||
      typeof mimeType !== 'string'
    )
      throw new EntityNotFoundException('Upload');
    return { file, sizeBytes, mimeType };
  }
  /** Called only after verifying the upload grant. CAS prevents replay/overwrites after activation. */
  async uploadReserved(
    organizationId: string,
    bucket: string,
    objectKey: string,
    body: Buffer,
    mimeType: string,
  ) {
    const { file } = await this.describeUpload(
      organizationId,
      bucket,
      objectKey,
    );
    const source = (file.metadata ?? {}) as Record<string, unknown>;
    if (file.status === 'AVAILABLE') {
      if (
        source.sourceSha256 === FileObjectService.hash(body) &&
        source.sourceSizeBytes === body.length &&
        source.sourceMimeType === mimeType
      )
        return file;
      throw new ValidationException(
        'Este upload já foi concluído com outro conteúdo.',
      );
    }
    if (file.status !== 'PENDING') throw new EntityNotFoundException('Upload');
    if (BigInt(body.length) !== file.sizeBytes || mimeType !== file.mimeType)
      throw new ValidationException(
        'O tamanho ou formato do arquivo difere do upload reservado.',
        undefined,
        'FILE_INVALID',
      );
    const metadata = (file.metadata ?? {}) as Record<string, unknown>;
    const namespace = metadata.namespace as StorageNamespace;
    if (!Object.values(STORAGE_NAMESPACES).includes(namespace))
      throw new ValidationException('Upload inválido.');
    if (
      mimeType === 'application/pdf' &&
      body.subarray(0, 5).toString('ascii') !== '%PDF-'
    )
      throw new ValidationException(
        'O conteúdo não corresponde a um PDF.',
        undefined,
        'FILE_INVALID',
      );
    const input = await this.normalize({ ...file, namespace, body, metadata });
    const canonicalKey = this.buildObjectKey(input);
    const data = this.toData(
      input,
      canonicalKey,
      BigInt(input.body.length),
      FileObjectService.hash(input.body),
    );
    data.metadata = {
      ...metadata,
      sourceSha256: FileObjectService.hash(body),
      sourceSizeBytes: body.length,
      sourceMimeType: mimeType,
      sourceObjectKey: objectKey,
      sourceBucket: bucket,
    };
    await this.put(data, input.body);
    try {
      const saved = await this.repository.completeUpload(
        file.id,
        organizationId,
        objectKey,
        {
          bucket: data.bucket,
          objectKey: data.objectKey,
          fileName: data.fileName,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
          sha256: data.sha256!,
          metadata: data.metadata as Prisma.InputJsonValue,
        },
      );
      if (!saved)
        throw new ValidationException('Este upload já foi utilizado.');
      return saved;
    } catch (error) {
      return this.recoverPublication(data, error);
    }
  }
  private async recoverPublication(
    data: CreateStorageFileData,
    error: unknown,
  ) {
    let published: StorageFile | null;
    try {
      published = await this.repository.resolvePublication(data);
    } catch {
      // Never delete bytes whose database commit may have succeeded. Operator
      // reconciliation may collect an orphan later; availability wins here.
      this.logger.error(
        JSON.stringify({
          stage: 'storage-publication-uncertain',
          organizationId: data.organizationId,
          objectFingerprint: FileObjectService.hash(
            Buffer.from(data.objectKey),
          ),
        }),
      );
      throw error;
    }
    if (published) {
      if (
        !published.deletedAt &&
        published.status === 'AVAILABLE' &&
        published.sha256 === data.sha256 &&
        published.sizeBytes === data.sizeBytes &&
        published.mimeType === data.mimeType
      )
        return published;
      throw error;
    }
    await this.cleanup(data.bucket, data.objectKey);
    throw error;
  }
  async confirm(id: string, organizationId: string) {
    const file = await this.confirmRegistered(id, organizationId);
    if (file.status !== 'AVAILABLE' || !file.sha256)
      throw new ValidationException(
        'O envio do arquivo ainda não foi concluído. Tente novamente.',
      );
    return file;
  }
  async confirmRegistered(id: string, organizationId: string) {
    const file = await this.repository.find(id, organizationId);
    if (!file) throw new EntityNotFoundException('StorageFile');
    return file;
  }
  read(bucket: string, objectKey: string): Promise<Buffer> {
    return this.provider.get({ bucket, objectKey });
  }
  async remove(bucket: string, objectKey: string): Promise<void> {
    try {
      await this.provider.remove({ bucket, objectKey });
      await this.repository.markDeletedByRef(bucket, objectKey);
    } catch (error) {
      const segments = objectKey.split('/');
      const organizationId = segments.find((part) =>
        /^[0-9a-f-]{36}$/.test(part),
      );
      if (organizationId && this.garbage)
        await this.garbage.enqueue(organizationId, bucket, objectKey);
      throw error;
    }
  }
  async sign(
    file: {
      bucket: string;
      objectKey: string;
      fileName: string;
      mimeType: string;
      status?: string;
      metadata?: unknown;
    },
    operation: SignedUrlOperation,
    expiresInSeconds?: number,
  ): Promise<SignedUrl> {
    const request = {
      ...file,
      operation,
      expiresInSeconds: expiresInSeconds ?? this.config.signedUrlTtlSeconds,
    };
    if (operation === 'upload') {
      // A resumed mobile intent may already have uploaded canonical bytes but
      // still await domain finalization. Renew the source capability, never PUT
      // authority for the canonical key (whose MIME may now be WebP).
      if (file.status === 'AVAILABLE') {
        const source =
          file.metadata && typeof file.metadata === 'object'
            ? (file.metadata as Record<string, unknown>)
            : {};
        if (
          typeof source.sourceBucket !== 'string' ||
          typeof source.sourceObjectKey !== 'string' ||
          typeof source.sourceMimeType !== 'string'
        )
          throw new ValidationException(
            'Este arquivo não aceita um novo envio.',
          );
        return uploadGrant(this.config, {
          ...request,
          bucket: source.sourceBucket,
          objectKey: source.sourceObjectKey,
          mimeType: source.sourceMimeType,
        });
      }
      return uploadGrant(this.config, request);
    }
    if (this.config.publicUrl && file.bucket === this.config.publicBucket)
      return {
        url: `${this.config.publicUrl}/${file.objectKey.split('/').map(encodeURIComponent).join('/')}`,
        method: 'GET',
        expiresAt: new Date('9999-12-31T00:00:00Z'),
        requiredHeaders: {},
      };
    return this.provider.sign(request);
  }
  private async normalize(input: StoreObjectInput): Promise<StoreObjectInput> {
    if (!input.mimeType.startsWith('image/')) return input;
    const body = await this.images.optimize(
      input.body,
      input.mimeType,
      input.namespace === 'avatars' || input.namespace === 'logos',
    );
    return {
      ...input,
      body,
      mimeType: 'image/webp',
      fileName: `${input.fileName.replace(/\.[^.]+$/, '').slice(0, 245)}.webp`,
    };
  }
  private buildObjectKey(input: {
    organizationId: string;
    namespace: StorageNamespace;
    fileName: string;
  }): string {
    const extension = extname(input.fileName).toLowerCase().slice(0, 12);
    return `${input.namespace}/${input.organizationId}/${Date.now()}-${generateUuidV7()}${/^\.[a-z0-9]+$/.test(extension) ? extension : ''}`;
  }
  private toData(
    input: Omit<StoreObjectInput, 'body'>,
    objectKey: string,
    sizeBytes: bigint,
    sha256: string | null,
  ): CreateStorageFileData {
    return {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId ?? null,
      provider: this.provider.name,
      bucket: this.isPublic(input.namespace)
        ? this.config.publicBucket!
        : this.config.bucket,
      objectKey,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes,
      sha256,
      status: sha256 ? 'AVAILABLE' : 'PENDING',
      metadata: input.metadata,
      createdById: input.createdById,
    };
  }
  private isPublic(namespace: StorageNamespace) {
    return (
      !!this.config.publicBucket &&
      (namespace === 'avatars' || namespace === 'logos')
    );
  }
  private put(data: CreateStorageFileData, body: Buffer) {
    return this.provider.put({
      bucket: data.bucket,
      objectKey: data.objectKey,
      body,
      mimeType: data.mimeType,
      cacheControl:
        data.bucket === this.config.publicBucket
          ? IMAGE_CACHE_CONTROL
          : 'private, no-store',
      metadata: { organization: data.organizationId, sha256: data.sha256! },
    });
  }
  private async cleanup(bucket: string, objectKey: string) {
    try {
      await this.remove(bucket, objectKey);
    } catch {
      this.logger.error(
        JSON.stringify({
          stage: 'storage-orphan-cleanup-failed',
          bucket,
          objectKey,
        }),
      );
    }
  }
}
