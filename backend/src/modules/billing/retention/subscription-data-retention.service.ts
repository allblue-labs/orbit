import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { FileObjectService } from '../../storage/file-object.service';
import {
  STORAGE_PROVIDER,
  type StorageProvider,
} from '../../storage/storage.types';
import {
  BILLING_PROVIDER,
  type BillingProvider,
  ProviderBillingState,
  ProviderCheckoutState,
} from '../billing.types';
import { grantsProductAccess } from '../../subscription-plans/subscriptions/subscription.types';
import { project } from '../../subscription-plans/subscriptions/subscription.projection';
import { OPERATIONAL_PURGE_TABLES, purgeOrder } from './purge-tables';
import { RVT_MAINTENANCE_TYPE_SEEDS } from '../../rvt/rvt-maintenance-types.seed';

const LEASE_MS = 10 * 60_000;
function awaitingPaidActivation(
  current: { status: string; providerSubscriptionId: string | null } | null,
): boolean {
  return (
    current?.status === 'PENDING_PAYMENT' && !!current.providerSubscriptionId
  );
}
@Injectable()
export class SubscriptionDataRetentionService {
  private readonly logger = new Logger(SubscriptionDataRetentionService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    private readonly files: FileObjectService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private platform<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
        return work(tx);
      },
      { timeout: 120_000 },
    );
  }

  async run(at = new Date()): Promise<void> {
    if (this.provider.isEnabled()) {
      // Apenas cancelamentos que receberam a política explicitamente. Sem exclusão retroativa.
      let cursor: string | undefined;
      for (;;) {
        const due = await this.platform((tx) =>
          tx.organizationSubscription.findMany({
            where: {
              dataRetentionEndsAt: { lte: at },
              ...(cursor ? { id: { gt: cursor } } : {}),
            },
            orderBy: { id: 'asc' },
            take: 25,
          }),
        );
        for (const subscription of due) {
          try {
            if (!(await this.readyForPurge(subscription, at))) continue;
            if (
              !(await this.claim(
                subscription.organizationId,
                subscription.id,
                at,
              ))
            )
              continue;
            await this.purge(subscription.organizationId, subscription.id, at);
          } catch (error) {
            this.logger.error(
              JSON.stringify({
                stage: 'subscription-data-purge-failed',
                organizationId: subscription.organizationId,
                errorCategory: error instanceof Error ? error.name : 'UNKNOWN',
              }),
            );
          }
        }
        if (due.length < 25) break;
        // ID permanece estável quando o prazo de uma página é limpo.
        cursor = due[due.length - 1]!.id;
      }
    }
    await this.removeQueuedFiles(at);
  }

  private async readyForPurge(
    subscription: {
      id: string;
      organizationId: string;
      providerSubscriptionId: string | null;
    },
    at: Date,
  ): Promise<boolean> {
    const state = await this.platform(async (tx) => {
      const current = await tx.organizationSubscription.findFirst({
        where: { organizationId: subscription.organizationId, endedAt: null },
      });
      const checkouts = await tx.billingCheckoutAttempt.findMany({
        where: {
          organizationId: subscription.organizationId,
          status: { in: ['CREATING', 'OPEN'] },
        },
      });
      return { current, checkouts };
    });
    // O Checkout já pode estar COMPLETED enquanto a fatura aguarda reconciliação.
    if (awaitingPaidActivation(state.current)) return false;
    if (
      state.current &&
      grantsProductAccess(
        project(
          {
            ...state.current,
            providerManaged: !!state.current.providerSubscriptionId,
          },
          at,
        ).status,
      )
    ) {
      await this.platform((tx) =>
        tx.organizationSubscription.update({
          where: { id: subscription.id },
          data: { dataRetentionEndsAt: null },
        }),
      );
      return false;
    }
    if (subscription.providerSubscriptionId) {
      const remote = await this.provider.retrieveSubscription(
        subscription.providerSubscriptionId,
      );
      if (remote.state !== ProviderBillingState.ENDED) return false;
    }
    for (const attempt of state.checkouts) {
      if (!attempt.providerSessionId) return false;
      const remote = await this.provider.retrieveCheckoutSession(
        attempt.providerSessionId,
      );
      // Uma compra concluída precisa ser reconciliada antes de qualquer exclusão.
      if (
        remote.state === ProviderCheckoutState.COMPLETE ||
        remote.state === ProviderCheckoutState.UNKNOWN
      )
        return false;
      if (remote.state === ProviderCheckoutState.OPEN)
        await this.provider.expireCheckoutSession(attempt.providerSessionId);
      await this.platform((tx) =>
        tx.billingCheckoutAttempt.updateMany({
          where: { id: attempt.id, status: { in: ['CREATING', 'OPEN'] } },
          data: { status: 'EXPIRED' },
        }),
      );
    }
    return true;
  }

  private claim(
    organizationId: string,
    subscriptionId: string,
    at: Date,
  ): Promise<boolean> {
    return this.platform(async (tx) => {
      const [lock] = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtextextended(${organizationId}, 0)) AS locked`;
      if (!lock?.locked) return false;
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
      });
      if (
        organization.dataPurgeStartedAt &&
        !organization.dataPurgedAt &&
        organization.dataPurgeStartedAt.getTime() > at.getTime() - LEASE_MS
      )
        return false;
      const source = await tx.organizationSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      if (!source.dataRetentionEndsAt || source.dataRetentionEndsAt > at)
        return false;
      const current = await tx.organizationSubscription.findFirst({
        where: { organizationId, endedAt: null },
      });
      if (awaitingPaidActivation(current)) return false;
      if (
        current &&
        grantsProductAccess(
          project(
            { ...current, providerManaged: !!current.providerSubscriptionId },
            at,
          ).status,
        )
      )
        return false;
      const checkout = await tx.billingCheckoutAttempt.findFirst({
        where: { organizationId, status: { in: ['CREATING', 'OPEN'] } },
      });
      if (checkout) return false;
      await tx.organization.update({
        where: { id: organizationId },
        data: { dataPurgeStartedAt: at, dataPurgedAt: null },
      });
      return true;
    });
  }

  private async purge(
    organizationId: string,
    subscriptionId: string,
    at: Date,
  ): Promise<void> {
    await this.platform(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))::text`;
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
      });
      const current = await tx.organizationSubscription.findFirst({
        where: { organizationId, endedAt: null },
      });
      if (
        current &&
        (awaitingPaidActivation(current) ||
          grantsProductAccess(
            project(
              { ...current, providerManaged: !!current.providerSubscriptionId },
              at,
            ).status,
          ))
      ) {
        await tx.organization.update({
          where: { id: organizationId },
          data: { dataPurgeStartedAt: null },
        });
        return;
      }
      const source = await tx.organizationSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      if (!source.dataRetentionEndsAt || source.dataRetentionEndsAt > at)
        return;
      // Outbox e exclusão dos registros pertencem ao mesmo commit.
      await tx.$executeRaw`INSERT INTO storage_deletion_jobs (id,organization_id,provider,bucket,object_key)
        SELECT gen_random_uuid(),organization_id,provider,bucket,object_key FROM storage_files WHERE organization_id = ${organizationId}::uuid
        ON CONFLICT (provider,bucket,object_key) DO NOTHING`;
      const edges = await tx.$queryRaw<
        { child: string; parent: string }[]
      >`SELECT child.relname AS child, parent.relname AS parent
        FROM pg_constraint fk JOIN pg_class child ON child.oid = fk.conrelid JOIN pg_class parent ON parent.oid = fk.confrelid
        JOIN pg_namespace n ON n.oid = child.relnamespace
        WHERE fk.contype = 'f' AND n.nspname = 'public' AND fk.confdeltype IN ('a','r','c')`;
      for (const table of purgeOrder(OPERATIONAL_PURGE_TABLES, edges)) {
        await tx.$queryRaw`SELECT app_purge_expired_tenant_table(${organizationId}::uuid, ${table})`;
      }
      await tx.session.deleteMany({
        where: { organizationId, userId: { not: organization.ownerUserId } },
      });
      await tx.businessUnitMembership.deleteMany({
        where: { organizationId, userId: { not: organization.ownerUserId } },
      });
      await tx.organizationMembership.deleteMany({
        where: { organizationId, userId: { not: organization.ownerUserId } },
      });
      await tx.businessUnit.deleteMany({
        where: { organizationId, isPrimary: false },
      });
      await tx.businessUnit.updateMany({
        where: { organizationId },
        data: { logoUrl: null },
      });
      await tx.rvtMaintenanceType.createMany({
        data: RVT_MAINTENANCE_TYPE_SEEDS.map((t) => ({ organizationId, ...t })),
        skipDuplicates: true,
      });
      await tx.organizationSubscription.updateMany({
        where: { organizationId, dataRetentionEndsAt: { lte: at } },
        data: { dataRetentionEndsAt: null },
      });
      await tx.organization.update({
        where: { id: organizationId },
        data: { dataPurgedAt: at, logoUrl: null, settings: {} },
      });
    });
    this.logger.log(
      JSON.stringify({
        stage: 'subscription-operational-data-purged',
        organizationId,
        purgedAt: at.toISOString(),
      }),
    );
  }

  private async removeQueuedFiles(at: Date): Promise<void> {
    const jobs = await this.platform((tx) =>
      tx.storageDeletionJob.findMany({
        where: { nextAttemptAt: { lte: at } },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
        take: 250,
      }),
    );
    for (const job of jobs) {
      try {
        if (job.provider !== this.storage.name)
          throw new Error('STORAGE_PROVIDER_MISMATCH');
        await this.files.remove(job.bucket, job.objectKey);
        await this.platform((tx) =>
          tx.storageDeletionJob.deleteMany({ where: { id: job.id } }),
        );
      } catch {
        await this.platform((tx) =>
          tx.storageDeletionJob.updateMany({
            where: { id: job.id },
            data: {
              attempts: { increment: 1 },
              nextAttemptAt: new Date(
                at.getTime() +
                  Math.min(60, 2 ** Math.min(job.attempts, 6)) * 60_000,
              ),
            },
          }),
        );
      }
    }
  }
}
