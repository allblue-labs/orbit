import {
  BillingRecoveryService,
  BillingRecoveryWorker,
} from './billing-recovery.service';
import { BillingWorkBudget } from './billing-work-budget';

describe('bounded recovery scheduling', () => {
  afterEach(() => {
    jest.useRealTimers();
    delete process.env.JOBS_WORKER_ENABLED;
  });
  it('polls independently of HTTP and stops the timer on shutdown', async () => {
    jest.useFakeTimers();
    const run = jest.fn().mockResolvedValue(undefined);
    const worker = new BillingRecoveryWorker({
      settings: { enabled: true, pollMs: 1000 },
      run,
    } as never);
    worker.onModuleInit();
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(2100);
    expect(run).toHaveBeenCalledTimes(3);
    await worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('does not overlap a slow execution in one replica and waits for shutdown', async () => {
    jest.useFakeTimers();
    let finish!: () => void;
    const run = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const worker = new BillingRecoveryWorker({
      settings: { enabled: true, pollMs: 1000 },
      run,
    } as never);
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(1);
    const stopped = worker.onModuleDestroy();
    finish();
    await stopped;
  });
  it.each([true, false])(
    'respects global worker disable with recovery enabled=%s',
    async (enabled) => {
      process.env.JOBS_WORKER_ENABLED = 'false';
      const run = jest.fn();
      const worker = new BillingRecoveryWorker({
        settings: { enabled, pollMs: 1000 },
        run,
      } as never);
      worker.onModuleInit();
      await worker.onModuleDestroy();
      expect(run).not.toHaveBeenCalled();
    },
  );
  it('exhausts nested SDK call budget and does not leak it into HTTP', async () => {
    await expect(
      BillingWorkBudget.run(1, 1000, async () => {
        BillingWorkBudget.consume();
        await Promise.resolve();
        BillingWorkBudget.consume();
      }),
    ).rejects.toThrow('BILLING_WORK_BUDGET_EXHAUSTED');
    expect(() => BillingWorkBudget.consume()).not.toThrow();
    expect(BillingWorkBudget.active()).toBe(false);
  });
  it('checks duration before starting another SDK call', async () => {
    await expect(
      BillingWorkBudget.run(10, 0, async () => {
        await Promise.resolve();
        BillingWorkBudget.consume();
      }),
    ).rejects.toThrow('BILLING_WORK_BUDGET_EXHAUSTED');
  });
  it('empty deployment variables use safe defaults, invalid bounds fail closed', () => {
    const previous = process.env.BILLING_RECOVERY_POLL_MS;
    try {
      process.env.BILLING_RECOVERY_POLL_MS = '';
      expect(
        new BillingRecoveryService({} as never, {} as never, {} as never)
          .settings.pollMs,
      ).toBe(10000);
      process.env.BILLING_RECOVERY_POLL_MS = '0';
      expect(
        () => new BillingRecoveryService({} as never, {} as never, {} as never),
      ).toThrow('Invalid BILLING_RECOVERY_POLL_MS');
    } finally {
      if (previous === undefined) delete process.env.BILLING_RECOVERY_POLL_MS;
      else process.env.BILLING_RECOVERY_POLL_MS = previous;
    }
  });
});
