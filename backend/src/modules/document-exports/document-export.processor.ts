/**
 * Gera o documento de uma exportação, no container `documents`.
 *
 * Roda já no contexto do tenant dono do job (o worker reabre organização e
 * escopo). O gerador é o do domínio — o mesmo código da rota síncrona —, e a
 * renderização acontece na thread encerrável do grupo `pdf`: estourou 120 s,
 * a thread recebe `terminate()` e o job volta à fila pelo backoff.
 *
 * ## Idempotente
 *
 * Uma exportação já concluída não é gerada de novo: o job pode reaparecer
 * depois de um lease expirado, e o arquivo já está no armazenamento.
 *
 * ## Falha
 *
 * Só a última tentativa (ou um erro permanente) fecha o registro como
 * `FAILED`; antes disso ele continua `PROCESSING` e o job repete.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import { classifyInternalError } from '../../errors';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import {
  JOB_QUEUES,
  JobTimeoutError,
  PermanentJobError,
  type BackgroundJobRecord,
  type JobProcessor,
} from '../jobs/background-job.types';
import { JobProcessorRegistry } from '../jobs/job-processor.registry';
import {
  FileObjectService,
  STORAGE_NAMESPACES,
} from '../storage/file-object.service';
import type { DocumentExportKind } from './document-export.read-models';
import { DocumentExportGeneratorRegistry } from './document-export.registry';

@Injectable()
export class DocumentExportProcessor implements JobProcessor, OnModuleInit {
  readonly queue = JOB_QUEUES.documentExport;
  private readonly logger = new Logger(DocumentExportProcessor.name);

  constructor(
    private readonly registry: JobProcessorRegistry,
    private readonly generators: DocumentExportGeneratorRegistry,
    private readonly rls: RlsTransaction,
    private readonly files: FileObjectService,
    private readonly jobs: BackgroundJobQueue,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: BackgroundJobRecord, signal?: AbortSignal): Promise<void> {
    const exportId = job.payload.exportId;
    if (typeof exportId !== 'string')
      throw new PermanentJobError('document export job without exportId');

    const row = await this.rls.run((tx) =>
      tx.documentExport.findFirst({ where: { id: exportId } }),
    );
    if (!row) throw new PermanentJobError('document export not found');
    if (row.status === 'COMPLETED' || row.status === 'FAILED') return;

    const generator = this.generators.get(row.kind as DocumentExportKind);
    if (!generator) throw new PermanentJobError(`no generator for ${row.kind}`);

    await this.rls.run((tx) =>
      tx.documentExport.updateMany({
        where: { id: row.id, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'PROCESSING', updatedAt: new Date() },
      }),
    );

    try {
      const document = await generator.generate({ export: row, job, signal });
      if (signal?.aborted) throw signal.reason;
      const file = await this.files.store({
        organizationId: row.organizationId,
        businessUnitId: row.businessUnitId,
        namespace: STORAGE_NAMESPACES.documentExport,
        fileName: document.fileName,
        mimeType: document.contentType,
        body: document.bytes,
        metadata: {
          documentExportId: row.id,
          kind: row.kind,
          correlationId: row.correlationId,
        },
        createdById: job.actorUserId,
      });
      await this.rls.run(async (tx) => {
        await tx.documentExport.update({
          where: { id: row.id },
          data: {
            status: 'COMPLETED',
            storageFileId: file.id,
            fileName: document.fileName,
            contentType: document.contentType,
            errorCode: null,
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        });
        /* A limpeza nasce com a exportação concluída, agendada para o
           vencimento — sem varredura periódica. */
        await this.jobs.enqueue(
          {
            queue: JOB_QUEUES.documentExportCleanup,
            jobKey: `document-export-cleanup:${row.id}`,
            organizationId: row.organizationId,
            ...(job.scope === 'BUSINESS_UNIT' && job.businessUnitId
              ? {
                  scope: 'BUSINESS_UNIT' as const,
                  businessUnitId: job.businessUnitId,
                }
              : {
                  scope: 'ORGANIZATION' as const,
                  businessUnitIds: job.businessUnitIds,
                }),
            payload: { exportId: row.id },
            correlationId: row.correlationId,
            actorUserId: job.actorUserId,
            availableAt: row.expiresAt,
          },
          tx,
        );
      });
    } catch (error) {
      const last =
        error instanceof PermanentJobError || job.attempts >= job.maxAttempts;
      if (last) {
        const classified = classifyInternalError(error);
        const code =
          error instanceof JobTimeoutError ||
          (signal?.aborted && signal.reason instanceof JobTimeoutError)
            ? 'EXPORT_TIMEOUT'
            : error instanceof PermanentJobError
              ? 'EXPORT_INVALID'
              : `EXPORT_${classified.category}`.slice(0, 60);
        await this.rls.run((tx) =>
          tx.documentExport.updateMany({
            where: { id: row.id, status: { in: ['PENDING', 'PROCESSING'] } },
            data: { status: 'FAILED', errorCode: code, updatedAt: new Date() },
          }),
        );
        this.logger.warn(
          JSON.stringify({
            event: 'document_export_failed',
            exportId: row.id,
            kind: row.kind,
            correlationId: row.correlationId,
            errorCode: code,
          }),
        );
      }
      throw error;
    }
  }
}
