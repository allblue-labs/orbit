import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { InfrastructureException } from '../../exceptions';
import { firebasePushCredentials } from './firebase-push.config';
import type { MobilePushPayloadReadModel } from './mobile-device.read-models';
import type {
  MobilePushDeliveryProvider,
  MobilePushResult,
  MobilePushTarget,
} from './mobile-push.provider';

/** One Admin app per Nest provider. No default credentials, tenant topics or external gateway. */
export class FirebaseMobilePushProvider
  implements MobilePushDeliveryProvider, OnModuleDestroy
{
  readonly name = 'firebase-admin';
  private readonly logger = new Logger(FirebaseMobilePushProvider.name);

  constructor(
    private readonly messaging: Pick<Messaging, 'send'>,
    private readonly close?: () => Promise<void>,
  ) {}

  static fromEnvironment(
    env: NodeJS.ProcessEnv = process.env,
  ): FirebaseMobilePushProvider {
    const credentials = firebasePushCredentials(env);
    try {
      const app = initializeApp(
        { projectId: credentials.projectId, credential: cert(credentials) },
        `orbit-push-${randomUUID()}`,
      );
      return new FirebaseMobilePushProvider(getMessaging(app), () =>
        deleteApp(app),
      );
    } catch {
      throw new InfrastructureException(
        'Firebase push initialization failed; check FIREBASE_* configuration',
      );
    }
  }

  async send(
    target: MobilePushTarget,
    payload: MobilePushPayloadReadModel,
  ): Promise<MobilePushResult> {
    if (target.provider !== 'FCM')
      return this.failure('PERMANENT_FAILURE', 'FCM_TOKEN_REQUIRED');
    try {
      const data: Record<string, string> = {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        ...payload.data,
        version: String(payload.version),
        notificationId: payload.notificationId,
        organizationId: payload.organizationId,
        tenantId: payload.organizationId,
        type: payload.data?.type ?? payload.type,
        eventType: payload.type,
        deepLink: payload.deepLink,
        title: payload.title,
        body: payload.body,
      };
      const providerMessageId = await this.messaging.send({
        token: target.token,
        data,
        // Data-only on Android: the existing native receiver displays the alert
        // and preserves its deep link in background as well as foreground.
        ...(target.platform === 'ANDROID'
          ? { android: { priority: 'high' as const, ttl: 24 * 60 * 60_000 } }
          : {
              apns: {
                headers: { 'apns-push-type': 'alert', 'apns-priority': '10' },
                payload: {
                  aps: {
                    alert: { title: payload.title, body: payload.body },
                    sound: 'default',
                  },
                },
              },
            }),
      });
      return { kind: 'ACCEPTED_BY_PROVIDER', providerMessageId };
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? error.code
          : undefined;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      )
        return this.failure('INVALID_TOKEN', code);
      // Invalid argument can mean a bad payload. Wrong project/APNs credentials
      // are configuration errors, NOT reasons to invalidate a device token.
      const permanent = [
        'messaging/invalid-argument',
        'messaging/invalid-payload',
        'messaging/invalid-data-payload-key',
        'messaging/payload-size-limit-exceeded',
        'messaging/mismatched-credential',
        'messaging/invalid-package-name',
        'messaging/authentication-error',
        'messaging/third-party-auth-error',
        'app/invalid-credential',
      ];
      if (typeof code === 'string' && permanent.includes(code))
        return this.failure('PERMANENT_FAILURE', code);
      const temporary = [
        'messaging/server-unavailable',
        'messaging/internal-error',
        'messaging/unknown-error',
        'messaging/quota-exceeded',
        'messaging/message-rate-exceeded',
        'messaging/device-message-rate-exceeded',
        'app/network-error',
        'app/network-timeout',
      ];
      return this.failure(
        'TEMPORARY_FAILURE',
        typeof code === 'string' && temporary.includes(code)
          ? code
          : 'FCM_UNAVAILABLE',
      );
    }
  }

  private failure(
    kind: 'INVALID_TOKEN' | 'TEMPORARY_FAILURE' | 'PERMANENT_FAILURE',
    code: string,
  ): MobilePushResult {
    this.logger.warn(
      JSON.stringify({ event: 'firebase_push_failed', kind, code }),
    );
    return { kind, code };
  }

  async onModuleDestroy(): Promise<void> {
    await this.close?.();
  }
}
