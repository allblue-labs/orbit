import { SubscriptionDataRetentionWorker } from './subscription-data-retention.worker';

describe('automatic data retention opt-in', () => {
  const environment = process.env;
  const run = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    process.env = { ...environment, ORBIT_PROCESS_ROLE: 'worker' };
    run.mockClear();
  });
  afterEach(() => {
    process.env = environment;
  });

  it.each([undefined, 'false', 'unexpected'])(
    'does not schedule destruction for %s',
    async (value) => {
      delete process.env.SUBSCRIPTION_DATA_RETENTION_ENABLED;
      if (value !== undefined)
        process.env.SUBSCRIPTION_DATA_RETENTION_ENABLED = value;
      const worker = new SubscriptionDataRetentionWorker({ run } as never);
      worker.onModuleInit();
      await worker.onModuleDestroy();
      expect(run).not.toHaveBeenCalled();
    },
  );

  it('runs when explicitly enabled on the worker', async () => {
    process.env.SUBSCRIPTION_DATA_RETENTION_ENABLED = 'true';
    const worker = new SubscriptionDataRetentionWorker({ run } as never);
    worker.onModuleInit();
    await worker.onModuleDestroy();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
