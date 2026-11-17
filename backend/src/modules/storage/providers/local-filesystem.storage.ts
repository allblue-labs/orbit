/**
 * Provider de sistema de arquivos — o padrão de desenvolvimento.
 *
 * ## Assinatura sem object store
 *
 * Não há serviço externo para assinar. A URL aponta para a própria API, e o
 * que a torna uma URL assinada é um HMAC-SHA256 sobre
 * `bucket|objectKey|operação|expiração`, com segredo de servidor. Trocar
 * qualquer parte invalida a assinatura, e a expiração é conferida na
 * verificação.
 *
 * A propriedade que importa é a mesma do S3: **quem tem a URL tem acesso
 * àquele objeto, por pouco tempo, e a nada mais**.
 *
 * ## Contenção de caminho
 *
 * `objectKey` vem do domínio, mas nunca é interpolado às cegas: o caminho
 * resolvido precisa ficar dentro da raiz configurada. Uma chave com `..`
 * escaparia do diretório e é recusada.
 */
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
  link,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { InfrastructureException } from '../../../exceptions';
import type {
  ObjectStat,
  PutObjectInput,
  SignedUrl,
  SignedUrlOperation,
  SignedUrlRequest,
  StorageObjectRef,
  StorageProvider,
  StorageProviderName,
} from '../storage.types';

export interface LocalSignaturePayload {
  readonly bucket: string;
  readonly objectKey: string;
  readonly operation: SignedUrlOperation;
  readonly expiresAt: number;
  readonly signature: string;
}

@Injectable()
export class LocalFilesystemStorageProvider implements StorageProvider {
  readonly name: StorageProviderName = 'LOCAL';

  constructor(
    readonly defaultBucket: string,
    private readonly root: string,
    private readonly publicBaseUrl: string,
    private readonly signingSecret: string,
  ) {}

  async put(input: PutObjectInput): Promise<ObjectStat> {
    const path = this.resolvePath(input);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temporary, input.body, { flag: 'wx', mode: 0o600 });
      // Hard-link publication is atomic and fails if the final key exists.
      await link(temporary, path);
    } catch {
      throw new InfrastructureException('Unable to persist the storage object');
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return {
      bucket: input.bucket,
      objectKey: input.objectKey,
      sizeBytes: input.body.length,
      mimeType: input.mimeType,
    };
  }

  async get(ref: StorageObjectRef): Promise<Buffer> {
    try {
      return await readFile(this.resolvePath(ref));
    } catch {
      throw new InfrastructureException('Storage object is unavailable');
    }
  }

  async head(ref: StorageObjectRef): Promise<ObjectStat | null> {
    try {
      const info = await stat(this.resolvePath(ref));
      return {
        ...ref,
        sizeBytes: info.size,
        mimeType: null,
      };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return null;
      throw new InfrastructureException('Unable to inspect the storage object');
    }
  }

  async remove(ref: StorageObjectRef): Promise<void> {
    try {
      await unlink(this.resolvePath(ref));
    } catch (error) {
      const code =
        typeof error === 'object' && error && 'code' in error
          ? error.code
          : undefined;
      if (code !== 'ENOENT') {
        throw new InfrastructureException(
          'Unable to remove the storage object',
        );
      }
    }
  }

  sign(request: SignedUrlRequest): Promise<SignedUrl> {
    if (request.operation === 'upload')
      return Promise.reject(
        new InfrastructureException(
          'Uploads require a reserved gateway capability',
        ),
      );
    const expiresAt = new Date(Date.now() + request.expiresInSeconds * 1000);
    const expires = Math.floor(expiresAt.getTime() / 1000);
    const signature = this.signature(
      request.bucket,
      request.objectKey,
      request.operation,
      expires,
    );

    const url = new URL(`${this.publicBaseUrl}/storage/objects`);
    url.searchParams.set('bucket', request.bucket);
    url.searchParams.set('key', request.objectKey);
    url.searchParams.set('operation', request.operation);
    url.searchParams.set('expires', String(expires));
    url.searchParams.set('signature', signature);
    if (request.fileName) url.searchParams.set('filename', request.fileName);

    return Promise.resolve({
      url: url.toString(),
      expiresAt,
      method: 'GET',
      requiredHeaders: {},
    });
  }

  /** Confere uma assinatura emitida por `sign`. Usado pela rota local. */
  verify(payload: LocalSignaturePayload): boolean {
    if (payload.expiresAt * 1000 < Date.now()) return false;

    const expected = this.signature(
      payload.bucket,
      payload.objectKey,
      payload.operation,
      payload.expiresAt,
    );
    const provided = Buffer.from(payload.signature, 'hex');
    const computed = Buffer.from(expected, 'hex');
    /** Comparação em tempo constante: assinatura é segredo verificável. */
    return (
      provided.length === computed.length && timingSafeEqual(provided, computed)
    );
  }

  private signature(
    bucket: string,
    objectKey: string,
    operation: SignedUrlOperation,
    expiresAt: number,
  ): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${bucket}|${objectKey}|${operation}|${expiresAt}`)
      .digest('hex');
  }

  private resolvePath(ref: StorageObjectRef): string {
    const base = resolve(this.root, ref.bucket);
    const path = resolve(base, ref.objectKey);
    if (
      !base.startsWith(`${resolve(this.root)}${sep}`) ||
      path === base ||
      !path.startsWith(`${base}${sep}`)
    ) {
      throw new InfrastructureException('Invalid storage object key');
    }
    return path;
  }
}
