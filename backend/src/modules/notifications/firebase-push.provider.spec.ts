import { generateKeyPairSync } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { getApps } from 'firebase-admin/app';
import type { Message } from 'firebase-admin/messaging';
import { FirebaseMobilePushProvider } from './firebase-push.provider';
import { firebasePushCredentials } from './firebase-push.config';
import { mobilePushProviderFactory } from './mobile-push.provider';

const payload = {
  version: 1,
  notificationId: 'notification-id',
  recipientUserId: 'recipient-id',
  organizationId: 'tenant-id',
  type: 'WORK_ASSIGNED',
  deepLink: '/field/work-items/SERVICE_OPERATION:id',
  title: 'Novo atendimento atribuído',
  body: 'Abra o Orbit para consultar os detalhes.',
  data: { tipo: 'atendimento', url: 'https://orbit.example.com/operacoes/id' },
} as const;
const target = {
  platform: 'ANDROID',
  provider: 'FCM',
  token: 'PRIVATE_DEVICE_TOKEN_CANARY',
} as const;
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const env = {
  FIREBASE_PROJECT_ID: 'orbit-push-test',
  FIREBASE_CLIENT_EMAIL: 'push@orbit-push-test.iam.gserviceaccount.com',
  FIREBASE_PRIVATE_KEY: privateKey,
};

describe('FirebaseMobilePushProvider', () => {
  let log: jest.SpyInstance;
  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());
  function fixture() {
    const send = jest
      .fn<Promise<string>, [Message]>()
      .mockResolvedValue('projects/orbit-push-test/messages/1');
    return { send, provider: new FirebaseMobilePushProvider({ send }) };
  }

  it('envia os dados de navegação como strings e mantém o receiver Android em segundo plano', async () => {
    const { provider, send } = fixture();
    await expect(provider.send(target, payload)).resolves.toMatchObject({
      kind: 'ACCEPTED_BY_PROVIDER',
    });
    expect(send).toHaveBeenCalledWith({
      token: target.token,
      data: {
        ...payload.data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        version: '1',
        notificationId: payload.notificationId,
        recipientUserId: payload.recipientUserId,
        organizationId: payload.organizationId,
        tenantId: payload.organizationId,
        type: 'WORK_ASSIGNED',
        eventType: 'WORK_ASSIGNED',
        deepLink: payload.deepLink,
        title: payload.title,
        body: payload.body,
      },
      notification: { title: payload.title, body: payload.body },
      android: {
        priority: 'high',
        ttl: 86_400_000,
        notification: {
          channelId: 'orbit_work',
          icon: 'ic_stat_orbit',
          tag: payload.notificationId,
        },
      },
    });
  });
  it('prepara alerta APNs quando o iPhone já fornece um token FCM', async () => {
    const { provider, send } = fixture();
    await provider.send({ ...target, platform: 'IOS' }, payload);
    expect(send.mock.calls[0]?.[0]?.apns?.payload?.aps).toMatchObject({
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
    });
  });
  it('falha de credencial APNs não impede o envio subsequente ao Android', async () => {
    const { provider, send } = fixture();
    send.mockRejectedValueOnce({ code: 'messaging/third-party-auth-error' });
    await expect(
      provider.send({ ...target, platform: 'IOS' }, payload),
    ).resolves.toEqual({
      kind: 'PERMANENT_FAILURE',
      code: 'messaging/third-party-auth-error',
    });
    await expect(provider.send(target, payload)).resolves.toMatchObject({
      kind: 'ACCEPTED_BY_PROVIDER',
    });
    expect(send.mock.calls[1][0]).toMatchObject({
      android: { priority: 'high', notification: { channelId: 'orbit_work' } },
    });
  });
  it('não confunde um token APNs puro com um token FCM inválido', async () => {
    const { provider, send } = fixture();
    await expect(
      provider.send({ ...target, platform: 'IOS', provider: 'APNS' }, payload),
    ).resolves.toEqual({
      kind: 'PERMANENT_FAILURE',
      code: 'FCM_TOKEN_REQUIRED',
    });
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    ['messaging/registration-token-not-registered', 'INVALID_TOKEN'],
    ['messaging/invalid-registration-token', 'INVALID_TOKEN'],
    ['messaging/invalid-argument', 'PERMANENT_FAILURE'],
    ['messaging/mismatched-credential', 'PERMANENT_FAILURE'],
    ['messaging/third-party-auth-error', 'PERMANENT_FAILURE'],
    ['messaging/server-unavailable', 'TEMPORARY_FAILURE'],
    ['messaging/quota-exceeded', 'TEMPORARY_FAILURE'],
    ['app/network-error', 'TEMPORARY_FAILURE'],
    ['CANARY_UNKNOWN_CODE', 'TEMPORARY_FAILURE'],
  ])('classifica %s sem vazar o erro bruto', async (code, kind) => {
    const { provider, send } = fixture();
    send.mockRejectedValue(
      Object.assign(
        new Error(`RAW_ERROR_CANARY ${target.token} ${privateKey}`),
        { code },
      ),
    );
    await expect(provider.send(target, payload)).resolves.toMatchObject({
      kind,
    });
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain(target.token);
    expect(output).not.toContain('RAW_ERROR_CANARY');
    expect(output).not.toContain('PRIVATE KEY');
    expect(output).not.toContain('CANARY_UNKNOWN_CODE');
  });
  it('inicializa apps isolados com credencial explícita e os libera no encerramento, sem enviar mensagens', async () => {
    const before = getApps().length;
    const first = FirebaseMobilePushProvider.fromEnvironment(env);
    const second = FirebaseMobilePushProvider.fromEnvironment(env);
    try {
      expect(getApps()).toHaveLength(before + 2);
      expect(
        getApps()
          .filter((app) => app.name.startsWith('orbit-push-'))
          .every((app) => app.options.projectId === env.FIREBASE_PROJECT_ID),
      ).toBe(true);
    } finally {
      await first.onModuleDestroy();
      await second.onModuleDestroy();
    }
    expect(getApps()).toHaveLength(before);
  });
  it('recusa configuração ausente ou malformada sem ler JSON/ADC nem expor segredos', () => {
    expect(() =>
      firebasePushCredentials({
        GOOGLE_APPLICATION_CREDENTIALS: '/must/not/be/read.json',
      }),
    ).toThrow(/FIREBASE_PROJECT_ID/);
    for (const key of [
      'FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL',
      'FIREBASE_PRIVATE_KEY',
    ]) {
      expect(() => firebasePushCredentials({ ...env, [key]: '' })).toThrow(key);
    }
    expect(() =>
      firebasePushCredentials({
        ...env,
        FIREBASE_PRIVATE_KEY: 'CANARY_INVALID_KEY',
      }),
    ).toThrow('FIREBASE_PRIVATE_KEY must be a valid RSA private key');
    expect(() =>
      firebasePushCredentials({
        ...env,
        FIREBASE_CLIENT_EMAIL: 'not-an-email',
      }),
    ).toThrow(/FIREBASE_CLIENT_EMAIL/);
    expect(
      firebasePushCredentials({
        ...env,
        FIREBASE_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n'),
      }).privateKey,
    ).toBe(privateKey.trim());
  });
  it('não faz envio sem habilitação explícita', () => {
    const previous = process.env.PUSH_PROVIDER;
    try {
      process.env.PUSH_PROVIDER = 'disabled';
      expect(mobilePushProviderFactory().name).toBe('disabled');
    } finally {
      if (previous === undefined) delete process.env.PUSH_PROVIDER;
      else process.env.PUSH_PROVIDER = previous;
    }
  });
});
