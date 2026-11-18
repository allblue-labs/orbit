/** Official AWS SDK v3 adapter for R2, S3 and MinIO. Credentials never leave the server. */
import { addAbortSignal, Readable } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
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
  implements StorageProvider, OnApplicationShutdown
{
  private readonly client: S3Client;
  private activeRequests = 0;
  private activeReads = 0;
  private readonly deadlineMs: number;
  private readonly aliases: Readonly<Record<string, string>>;
  private readonly logger = new Logger(S3CompatibleStorageProvider.name);
  constructor(
    readonly name: StorageProviderName,
    readonly defaultBucket: string,
    config: S3Config,
  ) {
    this.deadlineMs = config.deadlineMs ?? 20_000;
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
      maxAttempts: 2,
      requestHandler: {
        connectionTimeout: 3_000,
        requestTimeout: Math.min(this.deadlineMs, 10_000),
        throwOnRequestTimeout: true,
        httpsAgent: { maxSockets: 12 },
        httpAgent: { maxSockets: 12 },
      },
    });
  }
  onApplicationShutdown() {
    this.client.destroy();
  }
  async put(input: PutObjectInput): Promise<ObjectStat> {
    return this.execute('put', async (abortSignal) => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket(input.bucket),
          Key: input.objectKey,
          Body: input.body,
          ContentType: input.mimeType,
          ContentLength: input.body.length,
          IfNoneMatch: '*',
          CacheControl: input.cacheControl ?? 'private, no-store',
          Metadata: input.metadata,
        }),
        { abortSignal },
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
    return this.execute('get', async (abortSignal) => {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket(ref.bucket),
          Key: ref.objectKey,
        }),
        { abortSignal },
      );
      if (!(result.Body instanceof Readable))
        throw new Error('Missing Node.js object stream');
      const body = addAbortSignal(abortSignal, result.Body);
      // Signed client downloads do not buffer in this process. Internal reads
      // (evidence, branding and manifests) have a separate memory ceiling.
      const maxBytes = 64 * 1024 * 1024;
      let bytes = 0;
      const chunks: Buffer[] = [];
      try {
        if ((result.ContentLength ?? 0) > maxBytes)
          throw new Error('Object exceeds internal read limit');
        for await (const chunk of body as AsyncIterable<Buffer>) {
          bytes += chunk.length;
          if (bytes > maxBytes)
            throw new Error('Object exceeds internal read limit');
          chunks.push(chunk);
        }
        return Buffer.concat(chunks, bytes);
      } finally {
        body.destroy();
      }
    });
  }
  async head(ref: StorageObjectRef): Promise<ObjectStat | null> {
    return this.execute('head', async (abortSignal) => {
      try {
        const result = await this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket(ref.bucket),
            Key: ref.objectKey,
          }),
          { abortSignal },
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
    await this.execute('delete', (abortSignal) =>
      this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket(ref.bucket),
          Key: ref.objectKey,
        }),
        { abortSignal },
      ),
    );
  }
  async sign(request: SignedUrlRequest): Promise<SignedUrl> {
    if (request.operation === 'upload')
      throw new InfrastructureException(
        'Uploads require a reserved gateway capability',
      );
    return this.execute<SignedUrl>('sign', async () => {
      const command = new GetObjectCommand({
        Bucket: this.bucket(request.bucket),
        Key: request.objectKey,
        ResponseContentType: request.mimeType,
        ResponseContentDisposition:
          request.operation === 'preview'
            ? 'inline'
            : `attachment; filename*=UTF-8''${encodeURIComponent(request.fileName ?? 'arquivo')}`,
      });
      const requiredHeaders: Record<string, string> = {};
      return {
        url: await getSignedUrl(this.client, command, {
          expiresIn: request.expiresInSeconds,
        }),
        expiresAt: new Date(Date.now() + request.expiresInSeconds * 1000),
        method: 'GET',
        requiredHeaders,
      };
    });
  }
  private bucket(value: string): string {
    return this.aliases[value] ?? value;
  }
  private async execute<T>(
    operation: string,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const read = operation === 'get';
    if (this.activeRequests >= 16 || (read && this.activeReads >= 4)) {
      this.logResult(operation, 'busy', 0);
      throw new InfrastructureException(
        'O armazenamento está ocupado. Tente novamente.',
      );
    }
    this.activeRequests++;
    if (read) this.activeReads++;
    const signal = AbortSignal.timeout(this.deadlineMs);
    const started = performance.now();
    let result = 'ok';
    try {
      const value = await work(signal);
      if (value === null) result = 'missing';
      return value;
    } catch (error) {
      result = signal.aborted ? 'deadline' : 'error';
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
        }),
      );
      throw new InfrastructureException(
        'O armazenamento está indisponível. Tente novamente.',
      );
    } finally {
      this.activeRequests--;
      if (read) this.activeReads--;
      this.logResult(
        operation,
        result,
        Math.round(performance.now() - started),
      );
    }
  }

  private logResult(operation: string, result: string, durationMs: number) {
    this.logger.log(
      JSON.stringify({
        event: 'storage_request',
        provider: this.name,
        operation,
        result,
        durationMs,
      }),
    );
  }
}
