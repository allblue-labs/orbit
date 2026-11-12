import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService, RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.types';

/** Durable retry queue shared with the retention worker. No filesystem fallback. */
@Injectable()
export class StorageCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly logger = new Logger(StorageCleanupService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => {
      void this.drain().catch(() =>
        this.logger.error(
          'Storage cleanup failed; queued objects will be retried',
        ),
      );
    }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  enqueue(organizationId: string, bucket: string, objectKey: string) {
    return this.rls.run((tx) =>
      tx.storageDeletionJob.createMany({
        data: [
          {
            id: generateUuidV7(),
            organizationId,
            provider: this.storage.name,
            bucket,
            objectKey,
          },
        ],
        skipDuplicates: true,
      }),
    );
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      const platform = <T>(work: (tx: PrismaTransactionClient) => Promise<T>) =>
        this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
          return work(tx);
        });
      const jobs = await platform((tx) =>
        tx.storageDeletionJob.findMany({
          where: {
            provider: this.storage.name,
            nextAttemptAt: { lte: new Date() },
          },
          take: 25,
          orderBy: { createdAt: 'asc' },
        }),
      );
      // Network calls must never occupy a database transaction/pool connection.
      for (const job of jobs) {
        try {
          await this.storage.remove({
            bucket: job.bucket,
            objectKey: job.objectKey,
          });
          await platform(async (tx) => {
            await tx.storageFile.updateMany({
              where: {
                bucket: job.bucket,
                objectKey: job.objectKey,
                deletedAt: null,
              },
              data: { deletedAt: new Date() },
            });
            await tx.storageDeletionJob.deleteMany({ where: { id: job.id } });
          });
        } catch {
          await platform((tx) =>
            tx.storageDeletionJob.updateMany({
              where: { id: job.id },
              data: {
                attempts: { increment: 1 },
                nextAttemptAt: new Date(
                  Date.now() +
                    Math.min(3600, 60 * 2 ** Math.min(job.attempts, 6)) * 1000,
                ),
              },
            }),
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}
