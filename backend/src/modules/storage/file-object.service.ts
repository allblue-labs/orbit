/**
 * Serviço de arquivos — a porta que o domínio usa.
 *
 * Concentra três responsabilidades que nenhum módulo de domínio deve ter:
 *
 * 1. **decidir a chave do objeto** — organização, ano, mês e identificador,
 *    nunca um nome vindo do cliente;
 * 2. **calcular o hash** (Stage 6) — SHA-256 do conteúdo exatamente como
 *    armazenado, o mesmo valor que uma futura assinatura digital cobrirá;
 * 3. **emitir URLs assinadas** — sempre com prazo, sempre por objeto.
 *
 * Nada aqui conhece manifest, anexo ou execução. É o que permite ao mesmo
 * serviço atender os dois usos da PR-19 sem duplicação.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { extname } from 'node:path';
import { InfrastructureException } from '../../exceptions';
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

/** Namespaces de chave — separam o que tem ciclo de vida diferente. */
export const STORAGE_NAMESPACES = {
  manifest: 'manifests',
  attachment: 'attachments',
  /** Relatórios gerenciais: mesmo storage, ciclo de vida próprio. */
  report: 'reports',
  signature: 'signatures',
  evidence: 'field-evidence',
  /** Foto de perfil. Namespace próprio: outro dono, outro ciclo de vida. */
  avatar: 'avatars',
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
  /** Tamanho declarado; conferido na confirmação. */
  sizeBytes: number;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class FileObjectService {
  constructor(
    @Inject(STORAGE_PROVIDER) private readonly provider: StorageProvider,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    private readonly repository: StorageFileRepository,
  ) {}

  /** SHA-256 do conteúdo — o hash oficial da plataforma (Stage 6). */
  static hash(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }

  /**
   * Grava o conteúdo e registra o arquivo.
   *
   * O objeto vai para o storage **antes** do registro: um registro apontando
   * para um objeto inexistente é pior do que um objeto órfão, que a limpeza do
   * bucket resolve.
   */
  async store(input: StoreObjectInput) {
    const objectKey = this.buildObjectKey(input);
    const sha256 = FileObjectService.hash(input.body);

    await this.provider.put({
      bucket: this.config.bucket,
      objectKey,
      body: input.body,
      mimeType: input.mimeType,
      metadata: {
        organization: input.organizationId,
        sha256,
      },
    });

    return this.repository.create(
      this.toData(input, objectKey, BigInt(input.body.length), sha256),
    );
  }

  /** Versão transacional — usada quando o registro precisa acompanhar outro. */
  async storeWith(tx: Prisma.TransactionClient, input: StoreObjectInput) {
    const objectKey = this.buildObjectKey(input);
    const sha256 = FileObjectService.hash(input.body);

    await this.provider.put({
      bucket: this.config.bucket,
      objectKey,
      body: input.body,
      mimeType: input.mimeType,
      metadata: { organization: input.organizationId, sha256 },
    });

    return this.repository.createWith(
      tx,
      this.toData(input, objectKey, BigInt(input.body.length), sha256),
    );
  }

  /**
   * Reserva um objeto para upload direto.
   *
   * O arquivo nasce `PENDING`, sem hash: nada foi transferido ainda. Só a
   * confirmação, que lê o objeto e calcula o SHA-256 do que **realmente** foi
   * gravado, o torna `AVAILABLE`. Confiar no hash que o cliente informaria
   * seria confiar no cliente sobre o próprio conteúdo.
   */
  async reserve(input: ReserveObjectInput) {
    const objectKey = this.buildObjectKey(input);
    const file = await this.repository.create({
      ...this.toData(input, objectKey, BigInt(input.sizeBytes), null),
      status: 'PENDING',
    });

    const signed = await this.provider.sign({
      bucket: this.config.bucket,
      objectKey,
      operation: 'upload',
      expiresInSeconds: this.config.signedUrlTtlSeconds,
      mimeType: input.mimeType,
    });

    return { file, signed };
  }

  /**
   * Confirma um upload reservado.
   *
   * Lê o objeto do provider, calcula o hash do conteúdo armazenado e grava.
   * Se o objeto não estiver lá, o arquivo é marcado `MISSING` — estado honesto,
   * melhor do que um `AVAILABLE` que quebra no primeiro download.
   */
  async confirm(id: string, organizationId: string) {
    const file = await this.repository.find(id, organizationId);
    if (!file) {
      throw new InfrastructureException('Storage file is not registered');
    }
    const stat = await this.provider.head({
      bucket: file.bucket,
      objectKey: file.objectKey,
    });
    if (!stat) {
      await this.repository.markMissing(id);
      throw new InfrastructureException(
        'The reserved object was not uploaded to the storage provider',
      );
    }

    const body = await this.provider.get({
      bucket: file.bucket,
      objectKey: file.objectKey,
    });

    return this.repository.markAvailable(
      id,
      organizationId,
      BigInt(body.length),
      FileObjectService.hash(body),
    );
  }

  /**
   * Arquivo registrado, sem confirmar upload.
   *
   * Usado quando o objeto já foi confirmado antes e só se precisa da
   * referência interna para assinar.
   */
  async confirmRegistered(id: string, organizationId: string) {
    const file = await this.repository.find(id, organizationId);
    if (!file) {
      throw new InfrastructureException('Storage file is not registered');
    }
    return file;
  }

  /** Conteúdo do objeto — usado pela rota local de download assinado. */
  read(bucket: string, objectKey: string): Promise<Buffer> {
    return this.provider.get({ bucket, objectKey });
  }

  /** Remove um objeto pelo provider; metadata só deve ser expirada após sucesso. */
  remove(bucket: string, objectKey: string): Promise<void> {
    return this.provider.remove({ bucket, objectKey });
  }

  /** URL temporária de acesso a um arquivo já registrado (Stage 3). */
  sign(
    file: {
      bucket: string;
      objectKey: string;
      fileName: string;
      mimeType: string;
    },
    operation: SignedUrlOperation,
    expiresInSeconds?: number,
  ): Promise<SignedUrl> {
    return this.provider.sign({
      bucket: file.bucket,
      objectKey: file.objectKey,
      operation,
      expiresInSeconds: expiresInSeconds ?? this.config.signedUrlTtlSeconds,
      fileName: file.fileName,
      mimeType: file.mimeType,
    });
  }

  /**
   * Chave do objeto.
   *
   * `{organização}/{namespace}/{ano}/{mês}/{uuid}{extensão}`. O nome original
   * **não** entra: um nome vindo do cliente carrega acentuação, espaço,
   * caminho relativo e colisão. Ele é guardado no registro, que é onde serve —
   * e é o que a URL assinada devolve ao navegador.
   */
  private buildObjectKey(input: {
    organizationId: string;
    namespace: StorageNamespace;
    fileName: string;
  }): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const extension = extname(input.fileName).toLowerCase().slice(0, 12);
    const safeExtension = /^\.[a-z0-9]+$/.test(extension) ? extension : '';
    return `${input.organizationId}/${input.namespace}/${year}/${month}/${generateUuidV7()}${safeExtension}`;
  }

  private toData(
    input: {
      organizationId: string;
      businessUnitId?: string | null;
      fileName: string;
      mimeType: string;
      metadata?: Record<string, unknown>;
      createdById: string | null;
    },
    objectKey: string,
    sizeBytes: bigint,
    sha256: string | null,
  ): CreateStorageFileData {
    return {
      organizationId: input.organizationId,
      businessUnitId: input.businessUnitId ?? null,
      provider: this.provider.name,
      bucket: this.config.bucket,
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
}
