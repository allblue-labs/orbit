import { HttpStatus, Injectable } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import { BaseException, ForbiddenException } from '../../exceptions';

export const UPLOAD_LIMITS = Object.freeze({
  process: 8,
  tenant: 2,
  bodyMs: 60_000,
  idleMs: 15_000,
  overheadBytes: 65_536,
  maxBytes: 20 * 1024 * 1024,
  pendingBytes: 100_000_000,
  pendingFiles: 20,
});

export function uploadBusy(retryAfterSeconds: number) {
  return new BaseException(
    {
      code: 'RATE_LIMITED',
      message:
        'Há muitos envios em andamento. Aguarde um momento e tente novamente.',
      details: { retryAfterSeconds },
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** Admission is persisted in a short transaction; no connection is held during I/O. */
@Injectable()
export class UploadBudgetService {
  private active = 0;
  constructor(private readonly rls: RlsTransaction) {}

  async acquire(organizationId: string, storageFileId?: string) {
    if (this.active >= UPLOAD_LIMITS.process) throw uploadBusy(5);
    this.active++;
    const id = generateUuidV7();
    try {
      await this.rls.run(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'upload-budget:' + organizationId},0))`;
        const organization = await tx.organization.findUnique({
          where: { id: organizationId },
          select: { dataPurgeStartedAt: true, dataPurgedAt: true },
        });
        if (
          !organization ||
          organization.dataPurgeStartedAt ||
          organization.dataPurgedAt
        )
          throw new ForbiddenException(
            'O envio não está disponível para esta organização.',
            'ORGANIZATION_UNAVAILABLE',
          );
        await tx.$executeRaw`DELETE FROM storage_upload_admissions WHERE organization_id=${organizationId}::uuid AND expires_at<=now()`;
        const rows = await tx.storageUploadAdmission.findMany({
          where: { organizationId },
        });
        if (
          rows.length >= UPLOAD_LIMITS.tenant ||
          rows.some(
            (row) => row.storageFileId === storageFileId && storageFileId,
          )
        )
          throw uploadBusy(5);
        await tx.$executeRaw`INSERT INTO storage_upload_admissions(id,organization_id,storage_file_id,expires_at) VALUES (${id}::uuid,${organizationId}::uuid,${storageFileId ?? null}::uuid,now()+interval '180 seconds')`;
      });
    } catch (error) {
      this.active--;
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      this.active--;
      await this.rls.run((tx) =>
        tx.storageUploadAdmission.deleteMany({ where: { id, organizationId } }),
      );
    };
  }
}
