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
    expect(repository.disableInstallation).not.toHaveBeenCalled();
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
    expect(repository.disableInstallation).toHaveBeenCalledWith(
      '01900000-0000-7000-8000-000000000007',
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
});

function source() {
  return {
    delivery: jest.fn().mockResolvedValue({
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
      },
      notification: {
        id: '01900000-0000-7000-8000-000000000008',
        organizationId: job.organizationId,
        recipientUserId: job.actorUserId,
        type: 'WORK_ASSIGNED',
        title: 'Novo atendimento atribuído',
        body: 'Abra o Orbit.',
        payload: { deepLink: '/field/work-items/OPERATION:id' },
      },
    }),
    eligible: jest.fn().mockResolvedValue(true),
    update: jest.fn(),
    disableInstallation: jest.fn(),
  };
}
