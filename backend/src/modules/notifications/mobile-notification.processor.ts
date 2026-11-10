import { Injectable, type OnModuleInit } from '@nestjs/common';
import { JobProcessorRegistry } from '../jobs/job-processor.registry';
import {
  JOB_QUEUES,
  PermanentJobError,
  type BackgroundJobRecord,
  type JobProcessor,
} from '../jobs/background-job.types';
import {
  MobileNotificationPolicy,
  type MobileNotificationIntent,
} from './mobile-notification.policy';
import { MobilePushRepository } from './mobile-push.repository';
import {
  transactionalPushMessage,
  type TransactionalPushMessage,
} from './push-message';

@Injectable()
export class MobileNotificationProcessor implements JobProcessor, OnModuleInit {
  readonly queue = JOB_QUEUES.mobileNotification;
  constructor(
    private readonly registry: JobProcessorRegistry,
    private readonly repository: MobilePushRepository,
    private readonly policy: MobileNotificationPolicy,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: BackgroundJobRecord): Promise<void> {
    const { type, factId, resourceId, workItemId } = job.payload;
    if (
      !job.actorUserId ||
      typeof factId !== 'string' ||
      typeof resourceId !== 'string' ||
      ![
        'WORK_ASSIGNED',
        'ARTIFACT_AVAILABLE',
        'SYNC_ATTENTION_REQUIRED',
        'TRANSACTIONAL',
      ].includes(String(type)) ||
      (workItemId !== undefined && typeof workItemId !== 'string')
    )
      throw new PermanentJobError('Mobile notification intent is invalid');
    let message: TransactionalPushMessage | undefined;
    if (type === 'TRANSACTIONAL') {
      const value = job.payload.message;
      if (
        typeof value !== 'object' ||
        value === null ||
        !('title' in value) ||
        !('body' in value) ||
        !('data' in value)
      )
        throw new PermanentJobError('Transactional push message is invalid');
      try {
        message = transactionalPushMessage(value.title, value.body, value.data);
      } catch {
        throw new PermanentJobError('Transactional push message is invalid');
      }
    }
    const intent: MobileNotificationIntent = {
      organizationId: job.organizationId,
      businessUnitId: job.businessUnitId,
      recipientUserId: job.actorUserId,
      type: type as MobileNotificationIntent['type'],
      factId,
      resourceId,
      workItemId,
      correlationId: job.correlationId,
      ...(message ? { message } : {}),
    };
    await this.repository.materialize(intent, this.policy.resolve(intent));
  }
}
