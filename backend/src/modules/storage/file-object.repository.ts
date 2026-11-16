import { InfrastructureException } from '../../exceptions';
/**
 * Persistência dos objetos de arquivo.
 *
 * Toda leitura e escrita passa pela transação RLS: um arquivo pertence a uma
 * organização, e a política do banco recusa qualquer linha de outra — mesmo
 * que o serviço erre o filtro.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import { UPLOAD_LIMITS, uploadBusy } from './upload-budget.service';

export interface CreateStorageFileData {
  organizationId: string;
  businessUnitId?: string | null;
  provider: string;
  bucket: string;
  objectKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: bigint;
  sha256: string | null;
  status: 'PENDING' | 'AVAILABLE';
  metadata?: Record<string, unknown>;
  createdById: string | null;
}

@Injectable()
export class StorageFileRepository {
  constructor(private readonly rls: RlsTransaction) {}

  create(data: CreateStorageFileData) {
    return this.rls.run((tx) => this.createWith(tx, data));
  }

  createReserved(data: CreateStorageFileData) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'upload-budget:' + data.organizationId},0))`;
      const [budget] = await tx.$queryRaw<
        { count: bigint; bytes: bigint }[]
      >`SELECT count(*) AS count, coalesce(sum(size_bytes),0)::bigint AS bytes FROM storage_files WHERE organization_id=${data.organizationId}::uuid AND status='PENDING' AND deleted_at IS NULL AND created_at>now()-interval '1 hour'`;
      if (
        !budget ||
        Number(budget.count) >= UPLOAD_LIMITS.pendingFiles ||
        budget.bytes + data.sizeBytes > BigInt(UPLOAD_LIMITS.pendingBytes)
      )
        throw uploadBusy(60);
      return this.createWith(tx, data);
    });
  }

  /**
   * Criação dentro de uma transação já aberta.
   *
   * Registrar o arquivo e o que o referencia precisa acontecer junto: um
   * manifest emitido apontando para um arquivo que não existe é um estado que
   * o banco não deve conseguir representar nem por um instante.
   */
  async createWith(tx: Prisma.TransactionClient, data: CreateStorageFileData) {
    await this.publicationLock(tx, data);
    return tx.storageFile.create({
      data: {
        id: generateUuidV7(),
        organizationId: data.organizationId,
        businessUnitId: data.businessUnitId ?? null,
        provider: data.provider,
        bucket: data.bucket,
        objectKey: data.objectKey,
        fileName: data.fileName,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        sha256: data.sha256,
        status: data.status,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
        createdById: data.createdById,
      },
    });
  }

  private publicationLock(
    tx: Prisma.TransactionClient,
    data: Pick<CreateStorageFileData, 'provider' | 'bucket' | 'objectKey'>,
  ) {
    return tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'storage-publication:' + data.provider + ':' + data.bucket + ':' + data.objectKey},0))`;
  }

  /** Wait for the original publication transaction, including an ambiguous COMMIT ACK. */
  resolvePublication(
    data: Pick<
      CreateStorageFileData,
      'organizationId' | 'provider' | 'bucket' | 'objectKey'
    >,
  ) {
    return this.rls.run(async (tx) => {
      // The second statement must see the commit that released the lock. A
      // deployment with a different isolation level must preserve, never delete.
      const [isolation] = await tx.$queryRaw<
        { level: string }[]
      >`SELECT current_setting('transaction_isolation') AS level`;
      if (isolation?.level !== 'read committed')
        throw new InfrastructureException(
          'Storage publication state could not be confirmed',
        );
      await this.publicationLock(tx, data);
      return tx.storageFile.findFirst({
        where: {
          organizationId: data.organizationId,
          provider: data.provider,
          bucket: data.bucket,
          objectKey: data.objectKey,
        },
      });
    });
  }

  find(id: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.storageFile.findFirst({
        where: { id, organizationId, deletedAt: null },
      }),
    );
  }

  markDeletedByRef(bucket: string, objectKey: string) {
    return this.rls.run((tx) =>
      tx.storageFile.updateMany({
        where: { bucket, objectKey, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );
  }

  findByRef(organizationId: string, bucket: string, objectKey: string) {
    return this.rls.run((tx) =>
      tx.storageFile.findFirst({
        where: {
          organizationId,
          deletedAt: null,
          OR: [
            { bucket, objectKey },
            {
              AND: [
                { metadata: { path: ['sourceObjectKey'], equals: objectKey } },
                { metadata: { path: ['sourceBucket'], equals: bucket } },
              ],
            },
          ],
        },
      }),
    );
  }

  async completeUpload(
    id: string,
    organizationId: string,
    expectedKey: string,
    data: {
      bucket: string;
      objectKey: string;
      mimeType: string;
      fileName: string;
      sizeBytes: bigint;
      sha256: string;
      metadata: Prisma.InputJsonValue;
    },
  ) {
    return this.rls.run(async (tx) => {
      const existing = await tx.storageFile.findFirstOrThrow({
        where: { id, organizationId },
      });
      await this.publicationLock(tx, {
        provider: existing.provider,
        bucket: data.bucket,
        objectKey: data.objectKey,
      });
      const changed = await tx.storageFile.updateMany({
        where: {
          id,
          organizationId,
          objectKey: expectedKey,
          status: 'PENDING',
          deletedAt: null,
        },
        data: { ...data, status: 'AVAILABLE' },
      });
      if (changed.count !== 1) return null;
      return tx.storageFile.findFirst({
        where: { id, organizationId, deletedAt: null },
      });
    });
  }

  /** Confirma um upload assinado: grava tamanho, hash e disponibilidade. */
  markAvailable(
    id: string,
    organizationId: string,
    sizeBytes: bigint,
    sha256: string,
  ) {
    return this.rls.run((tx) =>
      tx.storageFile.update({
        where: { id, organizationId },
        data: { sizeBytes, sha256, status: 'AVAILABLE' },
        // O `where` do update não aceita a organização; a RLS a impõe.
      }),
    );
  }

  markMissing(id: string) {
    return this.rls.run((tx) =>
      tx.storageFile.update({ where: { id }, data: { status: 'MISSING' } }),
    );
  }
}
