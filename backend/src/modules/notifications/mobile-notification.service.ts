import { Injectable } from '@nestjs/common';
import type { MobileNotificationIntent } from './mobile-notification.policy';
import { MobileNotificationPolicy } from './mobile-notification.policy';
import { MobilePushRepository } from './mobile-push.repository';
import { RequestContextService } from '../../context';
import { ValidationException } from '../../exceptions';
import { BackgroundJobQueue } from '../jobs/background-job.queue';
import { JOB_QUEUES, scopeFor } from '../jobs/background-job.types';

@Injectable()
export class MobileNotificationService {
  constructor(
    private readonly policy: MobileNotificationPolicy,
    private readonly repository: MobilePushRepository,
    private readonly jobs: BackgroundJobQueue,
    private readonly contexts: RequestContextService,
  ) {}

  materialize(intent: MobileNotificationIntent) {
    const context = this.contexts.get();
    if (
      context.organizationId !== intent.organizationId ||
      (intent.businessUnitId &&
        !context.businessUnitIds.some((id) => id === intent.businessUnitId))
    )
      throw new ValidationException(
        'Notification scope is outside the current organization',
      );
    // As caixas de entrada e os dispositivos são privados ao destinatário.
    // O worker reabre esse escopo sem elevar as permissões do solicitante.
    if (context.userId !== intent.recipientUserId)
      return this.jobs.enqueue({
        queue: JOB_QUEUES.mobileNotification,
        jobKey: this.policy.resolve(intent).dedupeKey,
        organizationId: intent.organizationId,
        actorUserId: intent.recipientUserId,
        correlationId: intent.correlationId,
        payload: {
          type: intent.type,
          factId: intent.factId,
          resourceId: intent.resourceId,
          ...(intent.workItemId ? { workItemId: intent.workItemId } : {}),
        },
        ...scopeFor(intent.businessUnitId, context.businessUnitIds),
      });
    return this.repository.materialize(intent, this.policy.resolve(intent));
  }
}
