import { MobileNotificationService } from './mobile-notification.service';
import {
  MobileNotificationPolicy,
  type MobileNotificationIntent,
} from './mobile-notification.policy';
import type { EnqueueJobInput } from '../jobs/background-job.types';
import { ValidationException } from '../../exceptions';

describe('MobileNotificationService recipient isolation', () => {
  const intent: MobileNotificationIntent = {
    organizationId: 'org',
    businessUnitId: 'unit',
    recipientUserId: 'technician',
    type: 'WORK_ASSIGNED',
    factId: 'operation:version',
    resourceId: 'operation',
    correlationId: 'correlation',
  };
  function fixture(userId = 'owner') {
    const materialize = jest.fn().mockResolvedValue({ notification: {} });
    const enqueue = jest
      .fn<Promise<{ id: string }>, [EnqueueJobInput]>()
      .mockResolvedValue({ id: 'job' });
    const service = new MobileNotificationService(
      new MobileNotificationPolicy(),
      { materialize } as never,
      { enqueue } as never,
      {
        get: () => ({
          userId,
          organizationId: 'org',
          businessUnitIds: ['unit'],
        }),
      } as never,
    );
    return { service, materialize, enqueue };
  }
  it('enfileira para outro destinatário no escopo dele sem tocar sua caixa privada na transação do owner', async () => {
    const { service, materialize, enqueue } = fixture();
    await service.materialize(intent);
    expect(materialize).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: 'mobile.notification.materialize',
        organizationId: 'org',
        businessUnitId: 'unit',
        scope: 'BUSINESS_UNIT',
        actorUserId: 'technician',
        jobKey: 'WORK_ASSIGNED:operation:version:technician',
        payload: {
          type: 'WORK_ASSIGNED',
          factId: 'operation:version',
          resourceId: 'operation',
        },
      }),
    );
  });
  it('materializa diretamente quando o destinatário já é o usuário corrente', async () => {
    const { service, materialize, enqueue } = fixture('technician');
    await service.materialize(intent);
    expect(enqueue).not.toHaveBeenCalled();
    expect(materialize).toHaveBeenCalledTimes(1);
  });
  it('preserva o conteúdo customizado ao enfileirar para o contexto privado do destinatário', async () => {
    const { service, enqueue } = fixture();
    const message = {
      title: 'Aviso',
      body: 'Abra o Orbit.',
      data: { tipo: 'promocao', url: 'https://loja.example.com' },
    };
    await service.materialize({ ...intent, type: 'TRANSACTIONAL', message });
    expect(enqueue.mock.calls[0]?.[0]).toMatchObject({
      actorUserId: 'technician',
      organizationId: 'org',
      payload: { message },
    });
  });
  it.each([{ organizationId: 'foreign' }, { businessUnitId: 'foreign' }])(
    'recusa intenção fora do escopo corrente: %j',
    (patch) => {
      const { service, enqueue, materialize } = fixture();
      expect(() => service.materialize({ ...intent, ...patch })).toThrow(
        ValidationException,
      );
      expect(enqueue).not.toHaveBeenCalled();
      expect(materialize).not.toHaveBeenCalled();
    },
  );
});
