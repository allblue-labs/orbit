import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PermanentJobError } from '../jobs/background-job.types';
import {
  JOB_QUEUES,
  type BackgroundJobRecord,
  type JobProcessor,
  type JobQueue,
} from '../jobs/background-job.types';
import { JobProcessorRegistry } from '../jobs/job-processor.registry';
import type { MobilePushPayloadReadModel } from './mobile-device.read-models';
import { MobilePushMetrics } from './mobile-push.metrics';
import {
  MOBILE_PUSH_PROVIDER,
  type MobilePushDeliveryProvider,
} from './mobile-push.provider';
import { MobilePushRepository } from './mobile-push.repository';

@Injectable()
export class MobilePushProcessor implements JobProcessor, OnModuleInit {
  readonly queue: JobQueue = JOB_QUEUES.mobilePushDelivery;
  private readonly logger = new Logger(MobilePushProcessor.name);

  constructor(
    private readonly repository: MobilePushRepository,
    private readonly registry: JobProcessorRegistry,
    private readonly metrics: MobilePushMetrics,
    @Inject(MOBILE_PUSH_PROVIDER)
    private readonly provider: MobilePushDeliveryProvider,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: BackgroundJobRecord): Promise<void> {
    const deliveryId = job.payload.deliveryId;
    if (typeof deliveryId !== 'string')
      throw new PermanentJobError('Mobile push delivery id is invalid');
    const delivery = await this.repository.delivery(deliveryId);
    if (!delivery)
      throw new PermanentJobError('Mobile push delivery is unavailable');
    if (delivery.status === 'ACCEPTED_BY_PROVIDER') return;

    const installation = delivery.installation;
    const notification = delivery.notification;
    if (
      !installation.enabled ||
      installation.revokedAt ||
      installation.organizationId !== notification.organizationId ||
      installation.userId !== notification.recipientUserId
    ) {
      await this.repository.update(delivery.id, { status: 'SKIPPED' });
      return;
    }
    if (!(await this.repository.eligible(notification))) {
      await this.repository.update(delivery.id, { status: 'SKIPPED' });
      return;
    }

    const raw = this.record(notification.payload);
    const deepLink = raw.deepLink;
    if (typeof deepLink !== 'string' || !deepLink.startsWith('/field/'))
      throw new PermanentJobError('Mobile notification deep link is invalid');
    const payload: MobilePushPayloadReadModel = {
      version: 1,
      notificationId: notification.id,
      type: notification.type as MobilePushPayloadReadModel['type'],
      deepLink,
      title: notification.title.slice(0, 120),
      body: notification.body.slice(0, 240),
    };
    const result = await this.provider.send(
      {
        platform: installation.platform as 'IOS' | 'ANDROID',
        provider: installation.pushProvider as 'FCM' | 'APNS',
        token: installation.pushToken,
      },
      payload,
    );
    this.metrics.record(result.kind);
    this.logger.log(
      JSON.stringify({
        event: 'mobile_push_delivery',
        notificationType: notification.type,
        provider: this.provider.name,
        platform: installation.platform,
        result: result.kind,
        attempt: job.attempts,
        jobId: job.id,
      }),
    );

    if (result.kind === 'ACCEPTED_BY_PROVIDER') {
      await this.repository.update(delivery.id, {
        status: result.kind,
        provider: this.provider.name,
        providerMessageId: result.providerMessageId,
        attempts: { increment: 1 },
        acceptedAt: new Date(),
        lastErrorCode: null,
      });
      return;
    }
    if (result.kind === 'INVALID_TOKEN') {
      await this.repository.update(delivery.id, {
        status: result.kind,
        provider: this.provider.name,
        attempts: { increment: 1 },
        failedAt: new Date(),
        lastErrorCode: result.code,
      });
      await this.repository.disableInstallation(installation.id);
      return;
    }
    await this.repository.update(delivery.id, {
      status: result.kind,
      provider: this.provider.name,
      attempts: { increment: 1 },
      failedAt: result.kind === 'PERMANENT_FAILURE' ? new Date() : null,
      lastErrorCode: result.code,
    });
    if (result.kind === 'TEMPORARY_FAILURE')
      throw new Error(`Temporary mobile push failure: ${result.code}`);
  }

  private record(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  }
}
