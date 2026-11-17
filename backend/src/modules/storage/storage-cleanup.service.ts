import { STORAGE_CONFIG, type StorageConfig } from './storage.config';
import { hasForeignObjectReference } from './storage-ownership';
import {
  PublicMediaCacheService,
  MediaCachePending,
} from './public-media-cache.service';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { StorageDeletionJob } from '@prisma/client';
import { PrismaService, RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import { STORAGE_PROVIDER, type StorageProvider } from './storage.types';

/** Single durable consumer. Claims are fenced, recoverable and shared across replicas. */
@Injectable()
export class StorageCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private active: Promise<void> | null = null;
  private stopping = false;
  private readonly logger = new Logger(StorageCleanupService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly cache: PublicMediaCacheService,
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
  ) {}
  onModuleInit() {
    if ((process.env.JOBS_WORKER_ENABLED ?? 'true').trim() === 'false') return;
    this.timer = setInterval(
      () =>
        void this.drain().catch(() =>
          this.logger.error(
            'Storage cleanup failed; queued objects will be retried',
          ),
        ),
      60_000,
    );
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.active;
  }
  async enqueue(organizationId: string, bucket: string, objectKey: string) {
    const allowed = await this.rls.run((tx) =>
      tx.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      }),
    );
    if (!allowed) throw new Error('STORAGE_CLEANUP_TENANT_UNAVAILABLE');
    // The queue is platform-only under RLS; tenant context is verified before crossing that boundary.
    return this.platform((tx) =>
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
  private platform<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
      return work(tx);
    });
  }
  async drain(): Promise<void> {
    if (this.stopping || this.active) return;
    this.active = this.process();
    try {
      await this.active;
    } finally {
      this.active = null;
    }
  }
  private async process(): Promise<void> {
    // Claim one at a time: the lease never expires while waiting behind other I/O.
    for (let count = 0; count < 25 && !this.stopping; count++) {
      const token = generateUuidV7();
      const job = await this.platform(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM storage_deletion_jobs
          WHERE status <> 'COMPLETE' AND next_attempt_at <= clock_timestamp()
          AND (lease_until IS NULL OR lease_until <= clock_timestamp())
          ORDER BY next_attempt_at, created_at FOR UPDATE SKIP LOCKED LIMIT 1`;
        if (!rows[0]) return null;
        return tx.storageDeletionJob.update({
          where: { id: rows[0].id },
          data: {
            status: 'PROCESSING',
            leaseToken: token,
            leaseUntil: new Date(Date.now() + 5 * 60_000),
            attempts: { increment: 1 },
          },
        });
      });
      if (!job) break;
      try {
        if (job.provider !== this.storage.name)
          throw new CleanupBlocked('STORAGE_PROVIDER_MISMATCH');
        const aliases = this.config.s3?.legacyBucketAliases ?? {};
        const physical = aliases[job.bucket] ?? job.bucket;
        const buckets = [
          physical,
          job.bucket,
          ...Object.keys(aliases).filter(
            (alias) => aliases[alias] === physical,
          ),
        ];
        const foreign = await this.platform((tx) =>
          hasForeignObjectReference(
            tx,
            job.organizationId,
            {
              bucket: job.bucket,
              objectKey: job.objectKey,
            },
            buckets,
          ),
        );
        if (foreign) throw new CleanupBlocked('OBJECT_OWNERSHIP_CONFLICT');
        if (job.reason === 'RETENTION') {
          const purge = await this.platform((tx) =>
            tx.tenantDataPurge.findFirst({
              where: {
                id: job.purgeId ?? '',
                organizationId: job.organizationId,
                status: 'FILES_PENDING',
                databasePurgedAt: { not: null },
              },
            }),
          );
          if (!purge) throw new CleanupBlocked('PURGE_NOT_COMMITTED');
        }
        // No DB connection is held during provider I/O. Missing objects are idempotent.
        await this.storage.remove({
          bucket: job.bucket,
          objectKey: job.objectKey,
        });
        if (
          await this.storage.head({
            bucket: job.bucket,
            objectKey: job.objectKey,
          })
        )
          throw new Error('OBJECT_STILL_PRESENT');
        await this.platform((tx) =>
          tx.storageDeletionJob.updateMany({
            where: { id: job.id, leaseToken: token },
            data: { originDeletedAt: new Date() },
          }),
        );
        await this.cache.purge({
          bucket: job.bucket,
          objectKey: job.objectKey,
        });
        await this.platform(async (tx) => {
          const ack = await tx.storageDeletionJob.updateMany({
            where: { id: job.id, leaseToken: token },
            data: {
              status: 'COMPLETE',
              completedAt: new Date(),
              originDeletedAt: new Date(),
              leaseToken: null,
              leaseUntil: null,
              lastErrorCode: null,
            },
          });
          if (!ack.count) return; // A stale worker cannot acknowledge a newer lease.
          await tx.storageFile.updateMany({
            where: {
              organizationId: job.organizationId,
              provider: job.provider,
              bucket: job.bucket,
              objectKey: job.objectKey,
              deletedAt: null,
            },
            data: { deletedAt: new Date() },
          });
        });
      } catch (error) {
        await this.retry(
          job,
          token,
          error instanceof CleanupBlocked || error instanceof MediaCachePending
            ? error.code
            : 'STORAGE_DELETE_FAILED',
        );
      }
    }
    await this.platform(
      (tx) => tx.$executeRaw`UPDATE tenant_data_purges p SET status='COMPLETE',
      completed_at=clock_timestamp(), updated_at=clock_timestamp(), last_error_code=NULL
      WHERE p.status='FILES_PENDING' AND NOT EXISTS
      (SELECT 1 FROM storage_deletion_jobs j WHERE j.purge_id=p.id AND j.status<>'COMPLETE')`,
    );
  }
  private async retry(job: StorageDeletionJob, token: string, code: string) {
    await this.platform((tx) =>
      tx.storageDeletionJob.updateMany({
        where: { id: job.id, leaseToken: token },
        data: {
          status:
            code === 'STORAGE_DELETE_FAILED' || code === 'CACHE_PURGE_FAILED'
              ? 'RETRY'
              : 'BLOCKED',
          lastErrorCode: code,
          leaseToken: null,
          leaseUntil: null,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(3600, 60 * 2 ** Math.min(job.attempts - 1, 6)) * 1000,
          ),
        },
      }),
    );
    this.logger.warn(
      JSON.stringify({ stage: 'storage-delete-deferred', jobId: job.id, code }),
    );
  }
}
class CleanupBlocked extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
