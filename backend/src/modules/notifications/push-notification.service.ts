import { Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { RequestContextService } from '../../context';
import { ForbiddenException, ValidationException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import { MobileNotificationService } from './mobile-notification.service';
import { transactionalPushMessage } from './push-message';

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  constructor(
    private readonly contexts: RequestContextService,
    private readonly notifications: MobileNotificationService,
  ) {}

  /** Queues one delivery per active device under the current tenant's RLS scope.
   * No public send endpoint. Call from trusted business services after their authorization.
   * The existing worker retries transient Firebase failures without replaying successful devices.
   */
  async sendToUser(
    userId: string,
    title: string,
    body: string,
    dataPayload: Record<string, string> = {},
  ) {
    const context = this.contexts.get();
    if (
      !context.organizationId ||
      (context.actorType !== 'SYSTEM' &&
        context.userId !== userId &&
        !context.isOrganizationOwner &&
        !context.permissions.includes('*') &&
        !context.permissions.includes('notifications.create'))
    )
      throw new ForbiddenException(
        'Você não possui permissão para enviar esta notificação.',
      );
    if (!isUUID(userId))
      throw new ValidationException(
        'O destinatário da notificação é inválido.',
      );
    const message = transactionalPushMessage(title, body, dataPayload);
    const requestId = generateUuidV7();
    try {
      const result = await this.notifications.materialize({
        organizationId: context.organizationId,
        businessUnitId: context.businessUnitId,
        recipientUserId: userId,
        type: 'TRANSACTIONAL',
        factId: requestId,
        resourceId: requestId,
        correlationId: context.requestId,
        message,
      });
      return {
        status: result ? ('QUEUED' as const) : ('SKIPPED' as const),
        requestId,
      };
    } catch {
      this.logger.error(
        JSON.stringify({ event: 'push_enqueue_failed', requestId }),
      );
      return { status: 'FAILED' as const, requestId };
    }
  }
}
