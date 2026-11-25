import { OutboundHttp } from '../../network/outbound-http';
import { OutboundPolicy } from '../../network/outbound-policy';
import { Injectable } from '@nestjs/common';
import webpush from 'web-push';

export type DeliveryResult = {
  status: 'SENT' | 'SKIPPED';
  provider: string;
  providerMessageId?: string;
};

@Injectable()
export class EmailNotificationProvider {
  constructor() {}

  send(input: {
    to: string;
    subject: string;
    text: string;
  }): Promise<DeliveryResult> {
    // Operational notifications remain in the inbox/push. Only the owner template outbox sends mail.
    void input;
    return Promise.resolve({
      status: 'SKIPPED',
      provider: 'email-template-required',
    });
  }
}

@Injectable()
export class PushNotificationProvider {
  private readonly configured: boolean;

  constructor(
    private readonly http: OutboundHttp,
    private readonly outbound: OutboundPolicy,
  ) {
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

  async validateEndpoint(endpoint: string) {
    await this.outbound.authorize('WEB_PUSH', endpoint);
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
    this.http.url('WEB_PUSH', subscription.endpoint);
    const details = webpush.generateRequestDetails(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60, urgency: 'normal' },
    );
    await this.http.request('WEB_PUSH', details.endpoint, {
      headers: details.headers,
      body: details.body ?? Buffer.alloc(0),
    });
    return {
      status: 'SENT',
      provider: 'web-push',
    };
  }
}
