import type { BackgroundJobRecord } from '../jobs/background-job.types';
import { MobilePushMetrics } from './mobile-push.metrics';
import { MobilePushProcessor } from './mobile-push.processor';

const job: BackgroundJobRecord = {
  id: '01900000-0000-7000-8000-000000000001',
  queue: 'mobile.push.delivery',
  jobKey: 'mobile-push:delivery',
  organizationId: '01900000-0000-7000-8000-000000000002',
  businessUnitId: '01900000-0000-7000-8000-000000000003',
  businessUnitIds: ['01900000-0000-7000-8000-000000000003'],
  scope: 'BUSINESS_UNIT',
  payload: { deliveryId: '01900000-0000-7000-8000-000000000004' },
  status: 'RUNNING',
  attempts: 1,
  maxAttempts: 5,
  correlationId: '01900000-0000-7000-8000-000000000005',
  actorUserId: '01900000-0000-7000-8000-000000000006',
  lastError: null,
  availableAt: new Date(),
  createdAt: new Date(),
};

describe('MobilePushProcessor', () => {
  it('descarta a entrega quando a RLS oculta a instalação após trocar de conta', async () => {
    const repository = source();
    repository.delivery.mockResolvedValue({
      ...repository.record,
      installation: null,
    });
    const provider = { name: 'test', send: jest.fn() };
    const processor = new MobilePushProcessor(
      repository as never,
      { register: jest.fn() } as never,
      new MobilePushMetrics(),
      provider,
    );
    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(provider.send).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(repository.record.id, {
      status: 'SKIPPED',
    });
  });
  it('retries a temporary provider failure without disabling the installation', async () => {
    const repository = source();
    const provider = {
      name: 'test',
      send: jest
        .fn()
        .mockResolvedValue({ kind: 'TEMPORARY_FAILURE', code: 'TIMEOUT' }),
    };
    const processor = new MobilePushProcessor(
      repository as never,
      { register: jest.fn() } as never,
      new MobilePushMetrics(),
      provider,
    );
    await expect(processor.process(job)).rejects.toThrow(
      'Temporary mobile push failure',
    );
    expect(repository.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'TEMPORARY_FAILURE' }),
    );
    expect(repository.invalidateToken).not.toHaveBeenCalled();
  });

  it('makes invalid token terminal and removes it from targeting', async () => {
    const repository = source();
    const processor = new MobilePushProcessor(
      repository as never,
      { register: jest.fn() } as never,
      new MobilePushMetrics(),
      {
        name: 'test',
        send: jest
          .fn()
          .mockResolvedValue({ kind: 'INVALID_TOKEN', code: 'UNREGISTERED' }),
      },
    );
    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(repository.invalidateToken).toHaveBeenCalledWith(
      '01900000-0000-7000-8000-000000000004',
      '01900000-0000-7000-8000-000000000007',
      'token-hash',
      'UNREGISTERED',
      'test',
    );
  });

  it('records a permanent failure without retrying', async () => {
    const repository = source();
    const processor = new MobilePushProcessor(
      repository as never,
      { register: jest.fn() } as never,
      new MobilePushMetrics(),
      {
        name: 'test',
        send: jest.fn().mockResolvedValue({
          kind: 'PERMANENT_FAILURE',
          code: 'BAD_REQUEST',
        }),
      },
    );
    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(repository.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'PERMANENT_FAILURE' }),
    );
  });
  it('preserva os dados customizados até o provider de entrega', async () => {
    const repository = source();
    repository.record.notification.type = 'TRANSACTIONAL';
    repository.record.notification.payload.data = {
      tipo: 'promocao',
      url: 'https://loja.example.com',
    };
    const provider = {
      name: 'test',
      send: jest.fn().mockResolvedValue({ kind: 'ACCEPTED_BY_PROVIDER' }),
    };
    const processor = new MobilePushProcessor(
      repository as never,
      { register: jest.fn() } as never,
      new MobilePushMetrics(),
      provider,
    );
    await processor.process(job);
    expect(provider.send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        organizationId: job.organizationId,
        data: { tipo: 'promocao', url: 'https://loja.example.com' },
        deepLink: '',
      }),
    );
  });
  it('descarta uma entrega antiga quando o aparelho já foi vinculado a outro usuário', async () => {
    const repository = source();
    repository.record.installation.userId = 'different-user';
    const provider = { name: 'test', send: jest.fn() };
    const processor = new MobilePushProcessor(
      repository as never,
      { register: jest.fn() } as never,
      new MobilePushMetrics(),
      provider,
    );
    await processor.process(job);
    expect(provider.send).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(repository.record.id, {
      status: 'SKIPPED',
    });
  });
  it('não repete dispositivos já aceitos quando a fila reprocessa o job', async () => {
    const repository = source();
    repository.record.status = 'ACCEPTED_BY_PROVIDER';
    const provider = { name: 'test', send: jest.fn() };
    const processor = new MobilePushProcessor(
      repository as never,
      { register: jest.fn() } as never,
      new MobilePushMetrics(),
      provider,
    );
    await processor.process(job);
    expect(provider.send).not.toHaveBeenCalled();
  });
});

function source() {
  const record = {
    id: '01900000-0000-7000-8000-000000000004',
    status: 'PENDING',
    installation: {
      id: '01900000-0000-7000-8000-000000000007',
      organizationId: job.organizationId,
      userId: job.actorUserId,
      enabled: true,
      revokedAt: null,
      platform: 'IOS',
      pushProvider: 'APNS',
      pushToken: 'sensitive-token',
      pushTokenHash: 'token-hash',
    },
    notification: {
      id: '01900000-0000-7000-8000-000000000008',
      organizationId: job.organizationId,
      recipientUserId: job.actorUserId,
      type: 'WORK_ASSIGNED',
      title: 'Novo atendimento atribuído',
      body: 'Abra o Orbit.',
      payload: {
        deepLink: '/field/work-items/OPERATION:id',
        data: {} as Record<string, string>,
      },
    },
  };
  return {
    record,
    delivery: jest.fn().mockResolvedValue(record),
    eligible: jest.fn().mockResolvedValue(true),
    update: jest.fn(),
    invalidateToken: jest.fn(),
  };
}
