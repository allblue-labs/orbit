import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import { JOB_QUEUES, scopeFor } from '../jobs/background-job.types';
import { isUUID } from 'class-validator';
import { assignmentAuthorizationRequired } from '../operations/recurring-authorization';
import { fieldVisibilityFilter } from '../operations/operation-authorization';
import type { MobileNotificationIntent } from './mobile-notification.policy';
import type { ResolvedMobileNotification } from './mobile-notification.policy';

@Injectable()
export class MobilePushRepository {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly jobs: BackgroundJobQueue,
  ) {}

  async materialize(
    intent: MobileNotificationIntent,
    resolved: ResolvedMobileNotification,
  ) {
    if (
      intent.type === 'WORK_ASSIGNED' &&
      !(await this.eligible({
        ...intent,
        payload: {
          resourceId: intent.resourceId,
          workItemId: intent.workItemId,
          deepLink: resolved.deepLink,
        },
      }))
    )
      return null;
    return this.rls.runAmbient(async (tx) => {
      const recipient = await tx.organizationMembership.findFirst({
        where: {
          organizationId: intent.organizationId,
          userId: intent.recipientUserId,
          status: 'ACTIVE',
          deletedAt: null,
          user: { status: 'ACTIVE', deletedAt: null },
        },
      });
      if (!recipient) return null;
      if (intent.businessUnitId) {
        const unit = await tx.businessUnitMembership.count({
          where: {
            organizationId: intent.organizationId,
            businessUnitId: intent.businessUnitId,
            userId: intent.recipientUserId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (!unit) return null;
      }

      const notification = await tx.notification.upsert({
        where: {
          organizationId_dedupeKey: {
            organizationId: intent.organizationId,
            dedupeKey: resolved.dedupeKey,
          },
        },
        create: {
          organizationId: intent.organizationId,
          businessUnitId: intent.businessUnitId,
          recipientUserId: intent.recipientUserId,
          type: intent.type,
          dedupeKey: resolved.dedupeKey,
          channels: ['IN_APP', 'PUSH'],
          title: resolved.title,
          body: resolved.body,
          status: 'SENT',
          sentAt: new Date(),
          payload: {
            version: 1,
            deepLink: resolved.deepLink,
            resourceId: intent.resourceId,
            ...(intent.workItemId ? { workItemId: intent.workItemId } : {}),
            ...(resolved.data ? { data: resolved.data } : {}),
          },
          deliveries: {
            create: {
              recipientUserId: intent.recipientUserId,
              channel: 'IN_APP',
              status: 'SENT',
              provider: 'orbit-database',
              sentAt: new Date(),
            },
          },
        },
        update: {},
      });

      const preference = await tx.notificationPreference.findUnique({
        where: {
          organizationId_userId_type: {
            organizationId: intent.organizationId,
            userId: intent.recipientUserId,
            type: intent.type,
          },
        },
      });
      const pushEnabled =
        !preference ||
        (preference.enabled && preference.channels.includes('PUSH'));
      const installations = pushEnabled
        ? await tx.mobileDeviceInstallation.findMany({
            where: {
              organizationId: intent.organizationId,
              userId: intent.recipientUserId,
              enabled: true,
              revokedAt: null,
            },
            select: { id: true },
          })
        : [];
      await tx.mobilePushDelivery.createMany({
        data: installations.map((installation) => ({
          id: generateUuidV7(),
          organizationId: intent.organizationId,
          notificationId: notification.id,
          installationId: installation.id,
        })),
        skipDuplicates: true,
      });
      const deliveries = await tx.mobilePushDelivery.findMany({
        where: {
          notificationId: notification.id,
          installationId: { in: installations.map((item) => item.id) },
          status: { in: ['PENDING', 'TEMPORARY_FAILURE'] },
        },
      });
      const unitIds = intent.businessUnitId
        ? [intent.businessUnitId]
        : (
            await tx.businessUnitMembership.findMany({
              where: {
                organizationId: intent.organizationId,
                userId: intent.recipientUserId,
                status: 'ACTIVE',
                deletedAt: null,
              },
              select: { businessUnitId: true },
            })
          ).map((item) => item.businessUnitId);
      for (const delivery of deliveries)
        await this.jobs.enqueue(
          {
            queue: JOB_QUEUES.mobilePushDelivery,
            jobKey: `mobile-push:${delivery.id}`,
            organizationId: intent.organizationId,
            payload: { deliveryId: delivery.id },
            correlationId: intent.correlationId,
            actorUserId: intent.recipientUserId,
            maxAttempts: 5,
            ...scopeFor(intent.businessUnitId, unitIds),
          },
          tx,
        );
      return { notification, deliveries };
    });
  }

  delivery(id: string) {
    return this.rls.run(async (tx) => {
      const delivery = await tx.mobilePushDelivery.findFirst({
        where: { id },
        include: { notification: true },
      });
      if (!delivery) return null;
      // Rebinding the phone can make its old installation invisible under RLS.
      // Read it explicitly as nullable, never assume a required FK implies visibility.
      const installation = await tx.mobileDeviceInstallation.findFirst({
        where: {
          id: delivery.installationId,
          organizationId: delivery.organizationId,
          userId: delivery.notification.recipientUserId,
        },
      });
      return { ...delivery, installation };
    });
  }

  eligible(notification: {
    organizationId: string;
    businessUnitId: string | null;
    recipientUserId: string;
    type: string;
    payload: unknown;
  }) {
    return this.rls.run(async (tx) => {
      const membership = await tx.organizationMembership.count({
        where: {
          organizationId: notification.organizationId,
          userId: notification.recipientUserId,
          status: 'ACTIVE',
          deletedAt: null,
          user: { status: 'ACTIVE', deletedAt: null },
        },
      });
      if (!membership) return false;
      if (notification.businessUnitId) {
        const unit = await tx.businessUnitMembership.count({
          where: {
            organizationId: notification.organizationId,
            businessUnitId: notification.businessUnitId,
            userId: notification.recipientUserId,
            status: 'ACTIVE',
            deletedAt: null,
          },
        });
        if (!unit) return false;
      }
      const preference = await tx.notificationPreference.findUnique({
        where: {
          organizationId_userId_type: {
            organizationId: notification.organizationId,
            userId: notification.recipientUserId,
            type: notification.type,
          },
        },
      });
      if (
        preference &&
        (!preference.enabled || !preference.channels.includes('PUSH'))
      )
        return false;
      if (notification.type !== 'WORK_ASSIGNED') return true;
      const payload =
        typeof notification.payload === 'object' && notification.payload
          ? (notification.payload as Record<string, unknown>)
          : {};
      const authorization = fieldVisibilityFilter(
        await assignmentAuthorizationRequired(tx, notification.organizationId),
      );
      const workItemId =
        typeof payload.workItemId === 'string'
          ? payload.workItemId
          : typeof payload.deepLink === 'string'
            ? payload.deepLink.replace('/field/work-items/', '')
            : '';
      if (workItemId.startsWith('RVT:')) {
        const [, occurrenceId, extra] = workItemId.split(':');
        if (!occurrenceId || extra !== undefined || !isUUID(occurrenceId))
          return false;
        return Boolean(
          await tx.rvtOccurrence.findFirst({
            where: {
              id: occurrenceId,
              organizationId: notification.organizationId,
              deletedAt: null,
              status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
              responsibleFieldTechnicianId: notification.recipientUserId,
              ...authorization,
              configuration: { deletedAt: null, status: 'ACTIVE' },
            },
            select: { id: true },
          }),
        );
      }
      if (workItemId.startsWith('PMOC:')) {
        const [, cycleId, assetId, extra] = workItemId.split(':');
        if (
          !cycleId ||
          !assetId ||
          extra !== undefined ||
          !isUUID(cycleId) ||
          !isUUID(assetId)
        )
          return false;
        return Boolean(
          await tx.pmocExecution.findFirst({
            where: {
              id: cycleId,
              organizationId: notification.organizationId,
              ...authorization,
              status: { notIn: ['COMPLETED', 'CANCELLED'] },
              plan: {
                status: 'ACTIVE',
                deletedAt: null,
                schedulingPaused: false,
              },
              OR: [
                {
                  plan: {
                    technicianUserId: notification.recipientUserId,
                    coverages: { some: { assetId, deletedAt: null } },
                  },
                  equipmentSchedules: { none: { coverage: { assetId } } },
                  equipmentExecutions: { none: { assetId } },
                },
                {
                  equipmentSchedules: {
                    some: {
                      organizationId: notification.organizationId,
                      cancelledAt: null,
                      coverage: { assetId, deletedAt: null },
                      OR: [
                        {
                          responsibleFieldTechnicianId:
                            notification.recipientUserId,
                        },
                        {
                          auxiliaryTechnicianIds: {
                            has: notification.recipientUserId,
                          },
                        },
                      ],
                    },
                  },
                },
                {
                  equipmentExecutions: {
                    some: {
                      organizationId: notification.organizationId,
                      assetId,
                      status: { notIn: ['COMPLETED', 'CANCELLED'] },
                      OR: [
                        {
                          responsibleFieldTechnicianId:
                            notification.recipientUserId,
                        },
                        {
                          operation: {
                            auxiliaryTechnicians: {
                              some: {
                                userId: notification.recipientUserId,
                                removedAt: null,
                              },
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
            select: { id: true },
          }),
        );
      }
      if (typeof payload.resourceId !== 'string') return false;
      return Boolean(
        await tx.operation.findFirst({
          where: {
            id: payload.resourceId,
            organizationId: notification.organizationId,
            deletedAt: null,
            status: { notIn: ['CANCELLED', 'COMPLETED'] },
            ...authorization,
            OR: [
              { responsibleFieldTechnicianId: notification.recipientUserId },
              {
                auxiliaryTechnicians: {
                  some: {
                    userId: notification.recipientUserId,
                    removedAt: null,
                  },
                },
              },
            ],
          },
          select: { id: true },
        }),
      );
    });
  }

  update(id: string, data: Prisma.MobilePushDeliveryUpdateInput) {
    return this.rls.run((tx) =>
      tx.mobilePushDelivery.update({ where: { id }, data }),
    );
  }

  /** Atomic delivery result + compare-and-set cleanup. A refreshed/rebound
   * installation must never be revoked by a response for an older token. */
  invalidateToken(
    deliveryId: string,
    installationId: string,
    tokenHash: string,
    code: string,
    provider: string,
  ) {
    return this.rls.run(async (tx) => {
      await tx.mobileDeviceInstallation.updateMany({
        where: {
          id: installationId,
          pushTokenHash: tokenHash,
          enabled: true,
          revokedAt: null,
        },
        data: { enabled: false, revokedAt: new Date() },
      });
      await tx.mobilePushDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'INVALID_TOKEN',
          provider,
          attempts: { increment: 1 },
          failedAt: new Date(),
          lastErrorCode: code,
        },
      });
    });
  }
}
