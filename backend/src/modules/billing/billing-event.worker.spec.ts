import { BillingEventWorker } from './billing-event.worker';

describe('BillingEventWorker', () => {
  it('não sobrepõe ciclos na mesma réplica', async () => {
    let finish: (() => void) | undefined;
    const drainInbox = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const worker = new BillingEventWorker({ drainInbox } as never);

    const first = worker.tick();
    await worker.tick();
    expect(drainInbox).toHaveBeenCalledTimes(1);

    finish?.();
    await first;
    const third = worker.tick();
    expect(drainInbox).toHaveBeenCalledTimes(2);
    finish?.();
    await third;
    await worker.onModuleDestroy();
  });

  it('isola falha do ciclo para o próximo poll continuar', async () => {
    const drainInbox = jest
      .fn()
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValue(undefined);
    const worker = new BillingEventWorker({ drainInbox } as never);

    await expect(worker.tick()).resolves.toBeUndefined();
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(drainInbox).toHaveBeenCalledTimes(2);
  });
});
