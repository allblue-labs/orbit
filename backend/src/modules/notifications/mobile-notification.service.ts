import { Injectable } from '@nestjs/common';
import type { MobileNotificationIntent } from './mobile-notification.policy';
import { MobileNotificationPolicy } from './mobile-notification.policy';
import { MobilePushRepository } from './mobile-push.repository';

@Injectable()
export class MobileNotificationService {
  constructor(
    private readonly policy: MobileNotificationPolicy,
    private readonly repository: MobilePushRepository,
  ) {}

  materialize(intent: MobileNotificationIntent) {
    return this.repository.materialize(intent, this.policy.resolve(intent));
  }
}
