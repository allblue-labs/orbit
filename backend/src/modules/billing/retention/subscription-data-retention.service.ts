import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { StorageCleanupService } from '../../storage/storage-cleanup.service';
import { mediaInventory, hasPurgeBarrier } from './media-inventory';
import { generateUuidV7 } from '../../../utils';
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
    private readonly cleanup: StorageCleanupService,
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
            await this.platform(async (tx) => {
              await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${subscription.organizationId}, 0))::text`;
              await tx.tenantDataPurge.updateMany({
                where: {
                  organizationId: subscription.organizationId,
                  subscriptionId: subscription.id,
                  status: 'PREPARING',
                  claimedAt: at,
                },
                data: {
                  status: 'BLOCKED',
                  lastErrorCode: 'DATABASE_PURGE_FAILED',
                },
              });
              await tx.organization.updateMany({
                where: {
                  id: subscription.organizationId,
                  dataPurgeStartedAt: at,
                  dataPurgedAt: null,
                },
                data: { dataPurgeStartedAt: null },
              });
            });
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
    await this.cleanup.drain();
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
      // Same short transport fence used by upload admission; never held during object I/O.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'upload-budget:' + organizationId},0))::text`;
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
      if (await hasPurgeBarrier(tx, organizationId)) return false;
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
      const inventory = await mediaInventory(tx, organizationId);
      const unknown = inventory.some(
        (file) => !file.provider || !file.bucket || !file.objectKey,
      );
      await tx.tenantDataPurge.upsert({
        where: {
          organizationId_subscriptionId_retentionEndsAt: {
            organizationId,
            subscriptionId,
            retentionEndsAt: source.dataRetentionEndsAt,
          },
        },
        create: {
          id: generateUuidV7(),
          organizationId,
          subscriptionId,
          retentionEndsAt: source.dataRetentionEndsAt,
          claimedAt: at,
          status: unknown ? 'BLOCKED' : 'PREPARING',
          lastErrorCode: unknown ? 'LEGACY_LOCATION_UNVERIFIED' : null,
        },
        update: {
          status: unknown ? 'BLOCKED' : 'PREPARING',
          claimedAt: at,
          lastErrorCode: unknown ? 'LEGACY_LOCATION_UNVERIFIED' : null,
        },
      });
      if (unknown) return false;
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
    const committed = await this.platform(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))::text`;
      // Same short transport fence used by upload admission; never held during object I/O.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'upload-budget:' + organizationId},0))::text`;
      const organization = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
      });
      if (
        !organization.dataPurgeStartedAt ||
        organization.dataPurgedAt ||
        organization.dataPurgeStartedAt.getTime() !== at.getTime()
      )
        return;
      const checkout = await tx.billingCheckoutAttempt.findFirst({
        where: {
          organizationId,
          status: { in: ['CREATING', 'OPEN'] },
        },
      });
      const pendingWork = await hasPurgeBarrier(tx, organizationId);
      const current = await tx.organizationSubscription.findFirst({
        where: { organizationId, endedAt: null },
      });
      if (
        checkout ||
        pendingWork ||
        (current &&
          (awaitingPaidActivation(current) ||
            grantsProductAccess(
              project(
                {
                  ...current,
                  providerManaged: !!current.providerSubscriptionId,
                },
                at,
              ).status,
            )))
      ) {
        await tx.organization.update({
          where: { id: organizationId },
          data: { dataPurgeStartedAt: null },
        });
        await tx.tenantDataPurge.updateMany({
          where: { organizationId, subscriptionId, status: 'PREPARING' },
          data: {
            status: 'ABORTED',
            lastErrorCode: 'REACTIVATED_OR_WORK_PENDING',
          },
        });
        return false;
      }
      const source = await tx.organizationSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
      });
      if (!source.dataRetentionEndsAt || source.dataRetentionEndsAt > at) {
        await tx.organization.update({
          where: { id: organizationId },
          data: { dataPurgeStartedAt: null },
        });
        await tx.tenantDataPurge.updateMany({
          where: { organizationId, subscriptionId, status: 'PREPARING' },
          data: {
            status: 'ABORTED',
            lastErrorCode: 'RETENTION_DEADLINE_CHANGED',
          },
        });
        return false;
      }
      const purge = await tx.tenantDataPurge.findUniqueOrThrow({
        where: {
          organizationId_subscriptionId_retentionEndsAt: {
            organizationId,
            subscriptionId,
            retentionEndsAt: source.dataRetentionEndsAt,
          },
        },
      });
      const inventory = await mediaInventory(tx, organizationId);
      if (
        inventory.some(
          (file) => !file.provider || !file.bucket || !file.objectKey,
        )
      )
        throw new Error('LEGACY_LOCATION_UNVERIFIED');
      // The outbox and operational row deletion commit together. Never guess a legacy provider.
      for (const file of inventory) {
        const queued = await tx.$queryRaw<
          { id: string }[]
        >`INSERT INTO storage_deletion_jobs
          (id,organization_id,provider,bucket,object_key,purge_id,reason,status)
          VALUES (${generateUuidV7()}::uuid,${organizationId}::uuid,${file.provider},${file.bucket},
            ${file.objectKey},${purge.id}::uuid,'RETENTION','PENDING')
          ON CONFLICT (provider,bucket,object_key) DO UPDATE SET purge_id=EXCLUDED.purge_id,
            reason='RETENTION',status='PENDING',completed_at=NULL,lease_token=NULL,lease_until=NULL,
            next_attempt_at=clock_timestamp(),last_error_code=NULL
          WHERE storage_deletion_jobs.organization_id=EXCLUDED.organization_id
            AND (storage_deletion_jobs.lease_until IS NULL OR storage_deletion_jobs.lease_until <= clock_timestamp())
          RETURNING id`;
        if (!queued.length)
          throw new Error('OBJECT_DELETION_OWNERSHIP_OR_LEASE_CONFLICT');
      }
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
      const objectCount = await tx.storageDeletionJob.count({
        where: { purgeId: purge.id },
      });
      await tx.tenantDataPurge.update({
        where: { id: purge.id },
        data: {
          status: 'FILES_PENDING',
          databasePurgedAt: at,
          objectCount,
          lastErrorCode: null,
        },
      });
      return true;
    });
    if (!committed) return;
    this.logger.log(
      JSON.stringify({
        stage: 'subscription-operational-data-purged',
        organizationId,
        purgedAt: at.toISOString(),
      }),
    );
  }
}
