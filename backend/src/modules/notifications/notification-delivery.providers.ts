import { Injectable } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { InfrastructureException } from '../../exceptions';
import webpush from 'web-push';

export type DeliveryResult = {
  status: 'SENT' | 'SKIPPED';
  provider: string;
  providerMessageId?: string;
};

@Injectable()
export class EmailNotificationProvider {
  constructor(private readonly email: EmailService) {}

  async send(input: {
    to: string;
    subject: string;
    text: string;
  }): Promise<DeliveryResult> {
    const result = await this.email.send(input);
    if (result.status === 'FAILED')
      throw new InfrastructureException('Email notification delivery failed');
    return result;
  }
}

@Injectable()
export class PushNotificationProvider {
  private readonly configured: boolean;

  constructor() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    this.configured = Boolean(publicKey && privateKey);
    if (publicKey && privateKey) {
      webpush.setVapidDetails(
        process.env.VAPID_SUBJECT ?? 'mailto:admin@orbit.local',
        publicKey,
        privateKey,
      );
    }
  }

  async send(
    subscription: {
      endpoint: string;
      p256dh: string;
      auth: string;
    },
    payload: Record<string, unknown>,
  ): Promise<DeliveryResult> {
    if (!this.configured)
      return { status: 'SKIPPED', provider: 'web-push-unconfigured' };
    const result = await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60, urgency: 'normal' },
    );
    return {
      status: 'SENT',
      provider: 'web-push',
      providerMessageId: result.headers.location,
    };
  }
}
