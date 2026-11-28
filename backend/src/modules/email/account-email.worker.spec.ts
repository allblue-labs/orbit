import { AccountNoticesWorker } from './account-notices.worker';
describe('bounded account notice scan', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.useRealTimers();
  });
  it('does not start timers or scan when workers are disabled', async () => {
    process.env.JOBS_WORKER_ENABLED = 'false';
    const service = { scan: jest.fn() };
    const worker = new AccountNoticesWorker(service as never);
    worker.onModuleInit();
    await worker.onModuleDestroy();
    expect(service.scan).not.toHaveBeenCalled();
  });
  it('scans bounded pages, shares the active tick and waits for graceful shutdown', async () => {
    const service = { scan: jest.fn().mockResolvedValue('cursor') };
    const worker = new AccountNoticesWorker(service as never);
    await Promise.all([worker.tick(), worker.tick()]);
    expect(service.scan).toHaveBeenCalledTimes(4);
    await worker.onModuleDestroy();
    await worker.tick();
    expect(service.scan).toHaveBeenCalledTimes(4);
  });
});
