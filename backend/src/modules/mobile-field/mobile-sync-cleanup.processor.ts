import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  JOB_QUEUES,
  type JobProcessor,
  type JobQueue,
} from '../jobs/background-job.types';
import { JobProcessorRegistry } from '../jobs/job-processor.registry';
import { MobileOfflineSyncRepository } from './mobile-offline-sync.repository';

@Injectable()
export class MobileSyncCleanupProcessor implements JobProcessor, OnModuleInit {
  readonly queue: JobQueue = JOB_QUEUES.mobileSyncCleanup;
  private readonly logger = new Logger(MobileSyncCleanupProcessor.name);
  constructor(
    private readonly repository: MobileOfflineSyncRepository,
    private readonly registry: JobProcessorRegistry,
  ) {}
  onModuleInit(): void {
    this.registry.register(this);
  }
  async process(): Promise<void> {
    const started = performance.now();
    const result = await this.repository.cleanupExpired();
    this.logger.log(
      JSON.stringify({
        metric: 'mobile_sync_cleanup',
        receiptsDeleted: result.receiptsDeleted,
        journalDeleted: result.journalDeleted,
        durationMs: Number((performance.now() - started).toFixed(2)),
      }),
    );
  }
}
