import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { EntityNotFoundException, ValidationException } from '../../exceptions';
import type {
  CreateNotificationDto,
  NotificationPreferenceDto,
  NotificationQueryDto,
  RegisterPushSubscriptionDto,
} from './notification.dto';
import {
  EmailNotificationProvider,
  PushNotificationProvider,
  type DeliveryResult,
} from './notification-delivery.providers';
import { NotificationGateway } from './notification.gateway';
import { NotificationRepository } from './notification.repository';

@Injectable()
export class NotificationService {
  constructor(
    private readonly repository: NotificationRepository,
    private readonly email: EmailNotificationProvider,
    private readonly push: PushNotificationProvider,
    private readonly gateway: NotificationGateway,
  ) {}

  list(organizationId: string, userId: string, query: NotificationQueryDto) {
    return this.repository.list(organizationId, userId, query);
  }

  async get(id: string, organizationId: string, userId: string) {
    const notification = await this.repository.find(id, organizationId, userId);
    if (!notification) throw new EntityNotFoundException('Notification', id);
    return notification;
  }

  async create(organizationId: string, input: CreateNotificationDto) {
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now())
      throw new ValidationException(
        'Notification expiration must be in the future',
      );
    const recipient = await this.repository.findRecipient(
      input.recipientUserId,
      organizationId,
      input.businessUnitId,
    );
    if (!recipient)
      throw new ValidationException(
        'Recipient is not an active organization member',
      );
    const preference = await this.repository.preference(
      organizationId,
      input.recipientUserId,
      input.type,
    );
    const requested = [...new Set(input.channels)];
    const channels = preference
      ? preference.enabled
        ? requested.filter((channel) => preference.channels.includes(channel))
        : []
      : requested;
    if (!channels.includes('IN_APP')) channels.unshift('IN_APP');
    const notification = await this.repository.create(
      {
        organizationId,
        businessUnitId: input.businessUnitId,
        recipientUserId: input.recipientUserId,
        type: input.type.trim().toUpperCase(),
        channels,
        title: input.title.trim(),
        body: input.body.trim(),
        payload: input.payload as Prisma.InputJsonValue | undefined,
        scheduledAt: input.scheduledAt,
        expiresAt: input.expiresAt,
      },
      channels,
    );
    if (!input.scheduledAt || input.scheduledAt.getTime() <= Date.now())
      return this.dispatch(notification.id, organizationId);
    return notification;
  }

  async dispatch(id: string, organizationId: string) {
    const notification = await this.repository.find(id, organizationId);
    if (!notification) throw new EntityNotFoundException('Notification', id);
    if (
      notification.expiresAt &&
      notification.expiresAt.getTime() <= Date.now()
    )
      throw new ValidationException('Notification has expired');
    if (
      notification.scheduledAt &&
      notification.scheduledAt.getTime() > Date.now()
    )
      throw new ValidationException('Notification is not due yet');

    let sent = notification.deliveries.filter(
      (delivery) =>
        delivery.status === 'SENT' || delivery.status === 'DELIVERED',
    ).length;
    for (const delivery of notification.deliveries) {
      if (delivery.status === 'SENT' || delivery.status === 'DELIVERED')
        continue;
      try {
        const result = await this.deliver(delivery.channel, notification);
        await this.repository.updateDelivery(delivery.id, {
          status: result.status,
          provider: result.provider,
          providerMessageId: result.providerMessageId,
          attempts: { increment: 1 },
          sentAt: result.status === 'SENT' ? new Date() : undefined,
          lastError: null,
        });
        if (result.status === 'SENT') sent++;
      } catch (error) {
        await this.repository.updateDelivery(delivery.id, {
          status: 'FAILED',
          attempts: { increment: 1 },
          failedAt: new Date(),
          lastError:
            error instanceof Error
              ? error.constructor.name.slice(0, 160)
              : 'DELIVERY_FAILED',
        });
      }
    }
    await this.repository.markSent(id, sent > 0 ? 'SENT' : 'FAILED');
    return this.repository.find(id, organizationId);
  }

  async markRead(id: string, organizationId: string, userId: string) {
    await this.get(id, organizationId, userId);
    await this.repository.markRead(id, organizationId, userId);
    this.gateway.emitToUser(userId, 'notification:read', { id });
    return this.get(id, organizationId, userId);
  }

  async markAllRead(organizationId: string, userId: string) {
    const result = await this.repository.markAllRead(organizationId, userId);
    this.gateway.emitToUser(userId, 'notifications:read-all', {});
    return { updated: result.count };
  }

  preferences(organizationId: string, userId: string) {
    return this.repository.preferences(organizationId, userId);
  }

  preference(
    organizationId: string,
    userId: string,
    input: NotificationPreferenceDto,
  ) {
    return this.repository.upsertPreference(
      organizationId,
      userId,
      input.type.trim().toUpperCase(),
      {
        enabled: input.enabled,
        channels: [...new Set(input.channels)],
        quietHours: input.quietHours as Prisma.InputJsonValue | undefined,
      },
    );
  }

  registerPush(
    organizationId: string,
    userId: string,
    input: RegisterPushSubscriptionDto,
    userAgent?: string,
  ) {
    return this.repository.upsertSubscription({
      organizationId,
      userId,
      endpoint: input.endpoint,
      endpointHash: this.endpointHash(input.endpoint),
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent,
      expiresAt: input.expiresAt,
    });
  }

  async unregisterPush(
    organizationId: string,
    userId: string,
    endpoint: string,
  ) {
    await this.repository.revokeSubscription(
      organizationId,
      userId,
      this.endpointHash(endpoint),
    );
  }

  private async deliver(
    channel: string,
    notification: Awaited<ReturnType<NotificationRepository['find']>> & {},
  ): Promise<DeliveryResult> {
    if (!notification) throw new Error('Notification not found');
    if (channel === 'IN_APP')
      return { status: 'SENT', provider: 'orbit-database' };
    if (channel === 'REALTIME') {
      this.gateway.emitToUser(
        notification.recipientUserId,
        'notification:created',
        {
          id: notification.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          payload: notification.payload,
          createdAt: notification.createdAt,
        },
      );
      return { status: 'SENT', provider: 'socket.io' };
    }
    if (channel === 'EMAIL')
      return this.email.send({
        to: notification.recipient.email,
        subject: notification.title,
        text: notification.body,
      });
    if (channel === 'PUSH') {
      const subscriptions = await this.repository.subscriptions(
        notification.organizationId,
        notification.recipientUserId,
      );
      if (!subscriptions.length)
        return { status: 'SKIPPED', provider: 'no-active-subscription' };
      const results = await Promise.allSettled(
        subscriptions.map((subscription) =>
          this.push.send(subscription, {
            notificationId: notification.id,
            title: notification.title,
            body: notification.body,
            payload: notification.payload,
          }),
        ),
      );
      const success = results.find(
        (result) =>
          result.status === 'fulfilled' && result.value.status === 'SENT',
      );
      if (success?.status === 'fulfilled') return success.value;
      const failure = results.find((result) => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
      return { status: 'SKIPPED', provider: 'web-push-unconfigured' };
    }
    throw new ValidationException(
      `Unsupported notification channel: ${channel}`,
    );
  }

  private endpointHash(endpoint: string) {
    return createHash('sha256').update(endpoint).digest('hex');
  }
}
