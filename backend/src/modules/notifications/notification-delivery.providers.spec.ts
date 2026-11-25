import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { PushNotificationProvider } from './notification-delivery.providers';

describe('Web Push uses the shared outbound transport', () => {
  const previous = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  };
  const keys = webpush.generateVAPIDKeys();
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/token-secret',
    p256dh: createECDH('prime256v1').generateKeys().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  };
  const http = {
    url: jest.fn((_purpose: string, value: string) => new URL(value)),
    request: jest.fn(),
  };
  const policy = { authorize: jest.fn() };
  beforeEach(() => {
    jest.resetAllMocks();
    http.url.mockImplementation((_purpose, value) => new URL(value));
    http.request.mockResolvedValue({
      status: 201,
      body: Buffer.alloc(0),
      headers: {},
    });
    process.env.VAPID_PUBLIC_KEY = keys.publicKey;
    process.env.VAPID_PRIVATE_KEY = keys.privateKey;
    process.env.VAPID_SUBJECT = 'mailto:test@example.test';
  });
  afterAll(() => {
    for (const [key, value] of Object.entries({
      VAPID_PUBLIC_KEY: previous.publicKey,
      VAPID_PRIVATE_KEY: previous.privateKey,
      VAPID_SUBJECT: previous.subject,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  it('keeps real VAPID and encryption while replacing unbounded sendNotification', async () => {
    const direct = jest.spyOn(webpush, 'sendNotification');
    try {
      const provider = new PushNotificationProvider(
        http as never,
        policy as never,
      );
      expect(
        await provider.send(subscription, {
          title: 'Private notice',
          body: 'Private contents',
        }),
      ).toEqual({ status: 'SENT', provider: 'web-push' });
      expect(direct).not.toHaveBeenCalled();
      const call = http.request.mock.calls[0] as unknown as [
        string,
        string,
        { headers: Record<string, string>; body: Buffer },
      ];
      expect(call[0]).toBe('WEB_PUSH');
      expect(call[1]).toBe(subscription.endpoint);
      expect(call[2].headers.Authorization).toMatch(/^vapid /);
      expect(call[2].body.length).toBeGreaterThan(0);
      expect(call[2].body.includes(Buffer.from('Private contents'))).toBe(
        false,
      );
    } finally {
      direct.mockRestore();
    }
  });
  it('does not claim delivery when the bounded transport rejects the endpoint', async () => {
    http.request.mockRejectedValue(new Error('Denied'));
    await expect(
      new PushNotificationProvider(http as never, policy as never).send(
        subscription,
        {},
      ),
    ).rejects.toThrow('Denied');
  });
  it('checks the current DNS policy before registering an endpoint', async () => {
    policy.authorize.mockRejectedValue(new Error('DNS denied'));
    await expect(
      new PushNotificationProvider(
        http as never,
        policy as never,
      ).validateEndpoint(subscription.endpoint),
    ).rejects.toThrow('DNS denied');
    expect(policy.authorize).toHaveBeenCalledWith(
      'WEB_PUSH',
      subscription.endpoint,
    );
  });
  it('keeps unconfigured Web Push skipped without a network call', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    expect(
      await new PushNotificationProvider(http as never, policy as never).send(
        subscription,
        {},
      ),
    ).toEqual({ status: 'SKIPPED', provider: 'web-push-unconfigured' });
    expect(http.request).not.toHaveBeenCalled();
  });
});
