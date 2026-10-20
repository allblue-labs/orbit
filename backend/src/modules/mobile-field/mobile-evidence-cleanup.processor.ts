import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { FileObjectService } from '../storage/file-object.service';
import {
  JOB_QUEUES,
  type JobProcessor,
  type JobQueue,
} from '../jobs/background-job.types';
import { JobProcessorRegistry } from '../jobs/job-processor.registry';
import { mobileEvidencePolicy } from './mobile-evidence.config';
import { MobileEvidenceRepository } from './mobile-evidence.repository';

@Injectable()
export class MobileEvidenceCleanupProcessor
  implements JobProcessor, OnModuleInit
{
  readonly queue: JobQueue = JOB_QUEUES.mobileEvidenceCleanup;
  private readonly logger = new Logger(MobileEvidenceCleanupProcessor.name);
  constructor(
    private readonly repository: MobileEvidenceRepository,
    private readonly files: FileObjectService,
    private readonly registry: JobProcessorRegistry,
  ) {}
  onModuleInit(): void {
    this.registry.register(this);
  }
  async process(): Promise<void> {
    const started = performance.now();
    const batchSize = mobileEvidencePolicy().cleanupBatchSize;
    const candidates = await this.repository.expired(batchSize);
    let deleted = 0;
    for (const candidate of candidates) {
      // Metadata permanece disponível para retry até o provider confirmar a
      // remoção. `remove` é idempotente nos providers suportados.
      await this.files.remove(candidate.bucket, candidate.object_key);
      if (await this.repository.expire(candidate.id, candidate.storage_file_id))
        deleted += 1;
    }
    this.logger.log(
      JSON.stringify({
        metric: 'mobile_evidence_cleanup_total',
        batchSize,
        rowsScanned: candidates.length,
        rowsDeleted: deleted,
        storageDeletes: deleted,
        durationMs: Number((performance.now() - started).toFixed(2)),
      }),
    );
  }
}
