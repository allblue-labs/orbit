import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import {
  EmailNotificationProvider,
  PushNotificationProvider,
} from './notification-delivery.providers';
import { NotificationController } from './notification.controller';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationGateway } from './notification.gateway';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';
import { MobileDeviceController } from './mobile-device.controller';
import { MobileDeviceRepository } from './mobile-device.repository';
import { MobileDeviceService } from './mobile-device.service';
import { MobileNotificationPolicy } from './mobile-notification.policy';
import { MobileNotificationService } from './mobile-notification.service';
import { MobileNotificationProcessor } from './mobile-notification.processor';
import { MobilePushMetrics } from './mobile-push.metrics';
import { MobilePushProcessor } from './mobile-push.processor';
import {
  MOBILE_PUSH_PROVIDER,
  mobilePushProviderFactory,
} from './mobile-push.provider';
import { MobilePushRepository } from './mobile-push.repository';

@Module({
  imports: [IdentityModule],
  controllers: [
    NotificationPreferencesController,
    NotificationController,
    MobileDeviceController,
  ],
  providers: [
    NotificationRepository,
    NotificationService,
    NotificationGateway,
    EmailNotificationProvider,
    PushNotificationProvider,
    MobileDeviceRepository,
    MobileDeviceService,
    MobileNotificationPolicy,
    MobileNotificationService,
    MobileNotificationProcessor,
    MobilePushRepository,
    MobilePushProcessor,
    MobilePushMetrics,
    { provide: MOBILE_PUSH_PROVIDER, useFactory: mobilePushProviderFactory },
  ],
  exports: [
    NotificationService,
    NotificationGateway,
    MobileNotificationService,
  ],
})
export class NotificationsModule {}
