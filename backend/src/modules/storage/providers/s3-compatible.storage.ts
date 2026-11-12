/** Official AWS SDK v3 adapter for R2, S3 and MinIO. Credentials never leave the server. */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { InfrastructureException } from '../../../exceptions';
import type { S3Config } from '../storage.config';
import type {
  ObjectStat,
  PutObjectInput,
  SignedUrl,
  SignedUrlRequest,
  StorageObjectRef,
  StorageProvider,
  StorageProviderName,
} from '../storage.types';

@Injectable()
export class S3CompatibleStorageProvider
  implements StorageProvider, OnModuleDestroy
{
  private readonly client: S3Client;
  private readonly aliases: Readonly<Record<string, string>>;
  private readonly logger = new Logger(S3CompatibleStorageProvider.name);
  constructor(
    readonly name: StorageProviderName,
    readonly defaultBucket: string,
    config: S3Config,
  ) {
    this.aliases = config.legacyBucketAliases ?? {};
    this.client = new S3Client({
      ...config,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // R2 implements the S3 subset. Do not require optional AWS checksum extensions.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 3,
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 30_000 },
    });
  }
  onModuleDestroy() {
    this.client.destroy();
  }
  async put(input: PutObjectInput): Promise<ObjectStat> {
    return this.execute('put', async () => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket(input.bucket),
          Key: input.objectKey,
          Body: input.body,
          ContentType: input.mimeType,
          ContentLength: input.body.length,
          CacheControl: input.cacheControl ?? 'private, no-store',
          Metadata: input.metadata,
        }),
      );
      return {
        bucket: input.bucket,
        objectKey: input.objectKey,
        sizeBytes: input.body.length,
        mimeType: input.mimeType,
      };
    });
  }
  async get(ref: StorageObjectRef): Promise<Buffer> {
    return this.execute('get', async () => {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket(ref.bucket),
          Key: ref.objectKey,
        }),
      );
      if (!result.Body) throw new Error('Empty object body');
      return Buffer.from(await result.Body.transformToByteArray());
    });
  }
  async head(ref: StorageObjectRef): Promise<ObjectStat | null> {
    return this.execute('head', async () => {
      try {
        const result = await this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket(ref.bucket),
            Key: ref.objectKey,
          }),
        );
        return {
          ...ref,
          sizeBytes: result.ContentLength ?? 0,
          mimeType: result.ContentType ?? null,
        };
      } catch (error) {
        if (
          error instanceof S3ServiceException &&
          error.$metadata.httpStatusCode === 404
        )
          return null;
        throw error;
      }
    });
  }
  async remove(ref: StorageObjectRef): Promise<void> {
    await this.execute('delete', () =>
      this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket(ref.bucket),
          Key: ref.objectKey,
        }),
      ),
    );
  }
  async sign(request: SignedUrlRequest): Promise<SignedUrl> {
    return this.execute<SignedUrl>('sign', async () => {
      const command =
        request.operation === 'upload'
          ? new PutObjectCommand({
              Bucket: this.bucket(request.bucket),
              Key: request.objectKey,
              ContentType: request.mimeType,
            })
          : new GetObjectCommand({
              Bucket: this.bucket(request.bucket),
              Key: request.objectKey,
              ResponseContentType: request.mimeType,
              ResponseContentDisposition:
                request.operation === 'preview'
                  ? 'inline'
                  : `attachment; filename*=UTF-8''${encodeURIComponent(request.fileName ?? 'arquivo')}`,
            });
      const requiredHeaders: Record<string, string> = {};
      if (request.operation === 'upload' && request.mimeType)
        requiredHeaders['content-type'] = request.mimeType;
      return {
        url: await getSignedUrl(this.client, command, {
          expiresIn: request.expiresInSeconds,
        }),
        expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
        method: request.operation === 'upload' ? 'PUT' : 'GET',
        requiredHeaders,
      };
    });
  }
  private bucket(value: string): string {
    return this.aliases[value] ?? value;
  }
  private async execute<T>(
    operation: string,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      this.logger.error(
        JSON.stringify({
          stage: 'object-storage-failed',
          provider: this.name,
          operation,
          errorClass: error instanceof Error ? error.name : 'Unknown',
          status:
            error instanceof S3ServiceException
              ? error.$metadata.httpStatusCode
              : undefined,
          requestId:
            error instanceof S3ServiceException
              ? error.$metadata.requestId
              : undefined,
        }),
      );
      throw new InfrastructureException(
        'O armazenamento está indisponível. Tente novamente.',
      );
    }
  }
}
