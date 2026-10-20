import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { generateUuidV7 } from '../../utils';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import { JOB_QUEUES, scopeFor } from '../jobs/background-job.types';
import type { MobileNotificationIntent } from './mobile-notification.policy';
import type { ResolvedMobileNotification } from './mobile-notification.policy';

@Injectable()
export class MobilePushRepository {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly jobs: BackgroundJobQueue,
  ) {}

  materialize(
    intent: MobileNotificationIntent,
    resolved: ResolvedMobileNotification,
  ) {
    return this.rls.run(async (tx) => {
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
    return this.rls.run((tx) =>
      tx.mobilePushDelivery.findFirst({
        where: { id },
        include: { notification: true, installation: true },
      }),
    );
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
      if (notification.type !== 'WORK_ASSIGNED') return true;
      const payload =
        typeof notification.payload === 'object' && notification.payload
          ? (notification.payload as Record<string, unknown>)
          : {};
      if (typeof payload.resourceId !== 'string') return false;
      return Boolean(
        await tx.operation.findFirst({
          where: {
            id: payload.resourceId,
            organizationId: notification.organizationId,
            deletedAt: null,
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

  disableInstallation(id: string) {
    return this.rls.run((tx) =>
      tx.mobileDeviceInstallation.update({
        where: { id },
        data: { enabled: false, revokedAt: new Date() },
      }),
    );
  }
}
