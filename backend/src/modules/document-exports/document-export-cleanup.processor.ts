/**
 * Remove uma exportação vencida: primeiro o registro, depois o arquivo.
 *
 * ## A ordem importa
 *
 * `document_exports.storage_file_id` não pode ficar nulo numa linha
 * `COMPLETED` (CHECK `document_exports_completed_has_file`). Apagar o
 * registro **antes** do arquivo nunca deixa uma linha concluída apontando
 * para o nada. Se a remoção do arquivo falhar, o `FileObjectService` agenda a
 * coleta do objeto órfão — o pior caso é lixo no armazenamento, recolhido
 * depois, nunca um link que leva a um arquivo inexistente.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import {
  JOB_QUEUES,
  PermanentJobError,
  type BackgroundJobRecord,
  type JobProcessor,
} from '../jobs/background-job.types';
import { JobProcessorRegistry } from '../jobs/job-processor.registry';
import { FileObjectService } from '../storage/file-object.service';

@Injectable()
export class DocumentExportCleanupProcessor
  implements JobProcessor, OnModuleInit
{
  readonly queue = JOB_QUEUES.documentExportCleanup;

  constructor(
    private readonly registry: JobProcessorRegistry,
    private readonly rls: RlsTransaction,
    private readonly files: FileObjectService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: BackgroundJobRecord): Promise<void> {
    const exportId = job.payload.exportId;
    if (typeof exportId !== 'string')
      throw new PermanentJobError('cleanup job without exportId');

    const file = await this.rls.run(async (tx) => {
      const row = await tx.documentExport.findFirst({
        where: { id: exportId },
        include: { storageFile: true },
      });
      if (!row) return null;
      /* 1. O registro sai primeiro. */
      await tx.documentExport.delete({ where: { id: row.id } });
      return row.storageFile;
    });

    /* 2. Depois o arquivo — fora da transação, porque é rede. */
    if (file && !file.deletedAt)
      await this.files.remove(file.bucket, file.objectKey);
  }
}
