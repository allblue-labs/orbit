import type { BackgroundJobRecord } from '../jobs/background-job.types';
import { MobileNotificationPolicy } from './mobile-notification.policy';
import { MobileNotificationProcessor } from './mobile-notification.processor';

const job: BackgroundJobRecord = {
  id: 'job',
  queue: 'mobile.notification.materialize',
  jobKey: 'fact',
  organizationId: 'tenant',
  businessUnitId: 'unit',
  businessUnitIds: ['unit'],
  scope: 'BUSINESS_UNIT',
  actorUserId: 'recipient',
  correlationId: 'correlation',
  status: 'RUNNING',
  attempts: 1,
  maxAttempts: 5,
  lastError: null,
  availableAt: new Date(),
  createdAt: new Date(),
  payload: {
    type: 'TRANSACTIONAL',
    factId: 'fact',
    resourceId: 'resource',
    message: {
      title: 'Atendimento atribuído',
      body: 'Abra o Orbit.',
      data: {
        tipo: 'atendimento',
        deepLink: '/field/work-items/SERVICE_OPERATION:id',
      },
    },
  },
};

describe('MobileNotificationProcessor custom content', () => {
  function fixture() {
    const materialize = jest.fn();
    const processor = new MobileNotificationProcessor(
      { register: jest.fn() } as never,
      { materialize } as never,
      new MobileNotificationPolicy(),
    );
    return { materialize, processor };
  }
  it('restaura o tenant e destinatário do job, preservando os dados após serialização JSON', async () => {
    const { processor, materialize } = fixture();
    await processor.process({
      ...job,
      payload: JSON.parse(JSON.stringify(job.payload)) as Record<
        string,
        unknown
      >,
    });
    expect(materialize).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'tenant',
        recipientUserId: 'recipient',
        businessUnitId: 'unit',
      }),
      {
        dedupeKey: 'TRANSACTIONAL:fact:recipient',
        title: 'Atendimento atribuído',
        body: 'Abra o Orbit.',
        data: {
          tipo: 'atendimento',
          deepLink: '/field/work-items/SERVICE_OPERATION:id',
        },
        deepLink: '/field/work-items/SERVICE_OPERATION:id',
      },
    );
  });
  it.each([
    undefined,
    { title: 'Aviso', body: 'Abra o Orbit.', data: { tenantId: 'foreign' } },
  ])(
    'recusa conteúdo adulterado na fila sem criar uma entrega: %j',
    async (message) => {
      const { processor, materialize } = fixture();
      await expect(
        processor.process({ ...job, payload: { ...job.payload, message } }),
      ).rejects.toThrow('Transactional push message is invalid');
      expect(materialize).not.toHaveBeenCalled();
    },
  );
});
