import { Logger } from '@nestjs/common';
import { PushNotificationService } from './push-notification.service';
import {
  MobileNotificationPolicy,
  type MobileNotificationIntent,
} from './mobile-notification.policy';
import { transactionalPushMessage } from './push-message';

const recipient = '01900000-0000-7000-8000-000000000001';
function fixture(patch: Record<string, unknown> = {}) {
  const context = {
    organizationId: 'tenant-a',
    userId: 'owner',
    actorType: 'USER',
    permissions: ['notifications.create'],
    businessUnitId: 'unit-a',
    businessUnitIds: ['unit-a'],
    requestId: 'request-id',
    ...patch,
  };
  const materialize = jest
    .fn<Promise<{ id: string }>, [MobileNotificationIntent]>()
    .mockResolvedValue({ id: 'job-id' });
  return {
    materialize,
    service: new PushNotificationService(
      { get: () => context } as never,
      { materialize } as never,
    ),
  };
}

describe('PushNotificationService', () => {
  it('usa a organização do contexto e enfileira conteúdo e navegação para todos os dispositivos do destinatário', async () => {
    const { service, materialize } = fixture();
    const data = {
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
      tipo: 'atendimento',
      deepLink: '/field/work-items/SERVICE_OPERATION:id',
      url: 'https://orbit.example.com/operacoes/id',
    };
    await expect(
      service.sendToUser(
        recipient,
        'Atendimento atribuído',
        'Abra o Orbit.',
        data,
      ),
    ).resolves.toMatchObject({ status: 'QUEUED' });
    const intent = materialize.mock.calls[0]?.[0] as Parameters<
      MobileNotificationPolicy['resolve']
    >[0];
    expect(intent).toMatchObject({
      organizationId: 'tenant-a',
      businessUnitId: 'unit-a',
      recipientUserId: recipient,
      type: 'TRANSACTIONAL',
      message: { title: 'Atendimento atribuído', body: 'Abra o Orbit.', data },
    });
    expect(new MobileNotificationPolicy().resolve(intent)).toMatchObject({
      data,
      deepLink: data.deepLink,
    });
  });
  it.each([{ organizationId: null }, { permissions: [] }])(
    'recusa ausência de escopo ou autorização: %j',
    async (patch) => {
      const { service, materialize } = fixture(patch);
      await expect(
        service.sendToUser(recipient, 'Aviso', 'Abra o Orbit.'),
      ).rejects.toThrow(/permissão/);
      expect(materialize).not.toHaveBeenCalled();
    },
  );
  it('aceita um evento confiável do worker sem permissões congeladas do owner', async () => {
    const { service } = fixture({ actorType: 'SYSTEM', permissions: [] });
    await expect(
      service.sendToUser(recipient, 'Aviso', 'Abra o Orbit.'),
    ).resolves.toMatchObject({ status: 'QUEUED' });
  });
  it('contém uma falha de persistência sem expor a exceção ou derrubar o fluxo chamador', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    try {
      const { service, materialize } = fixture();
      materialize.mockRejectedValue(new Error('DATABASE_SECRET_CANARY'));
      await expect(
        service.sendToUser(recipient, 'Aviso', 'Abra o Orbit.'),
      ).resolves.toMatchObject({ status: 'FAILED' });
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'DATABASE_SECRET_CANARY',
      );
    } finally {
      log.mockRestore();
    }
  });
  it.each([
    { tenantId: 'foreign' },
    { notificationId: 'foreign' },
    { version: '999' },
    { 'google.key': 'reserved' },
    { url: 'javascript:alert(1)' },
    { url: 'https://user:password@example.com' },
    { deepLink: '//foreign.example.com/' },
    { value: 123 },
    { huge: 'á'.repeat(2_000) },
  ])('recusa dados reservados, não textuais ou inseguros: %j', async (data) => {
    const { service, materialize } = fixture();
    await expect(
      service.sendToUser(
        recipient,
        'Aviso',
        'Abra o Orbit.',
        data as unknown as Record<string, string>,
      ),
    ).rejects.toThrow();
    expect(materialize).not.toHaveBeenCalled();
  });
  it('permite payload sem link para abrir o app sem executar uma ação', () => {
    expect(transactionalPushMessage('Aviso', 'Abra o Orbit.', {})).toEqual({
      title: 'Aviso',
      body: 'Abra o Orbit.',
      data: {},
    });
  });
});
