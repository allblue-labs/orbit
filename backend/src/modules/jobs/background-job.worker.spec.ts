import type { RequestContextStorage } from '../../context';
import type { BackgroundJobQueue } from './background-job.queue';
import { BackgroundJobWorker } from './background-job.worker';
import type { JobProcessorRegistry } from './job-processor.registry';

describe('BackgroundJobWorker lifecycle', () => {
  it('stops new claims and waits for the in-flight tick before shutdown', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let claimed!: () => void;
    const claimStarted = new Promise<void>((resolve) => {
      claimed = resolve;
    });
    const queue = {
      requeueStalled: jest.fn().mockResolvedValue(undefined),
      claim: jest.fn().mockImplementation(() => {
        claimed();
        return blocked.then(() => null);
      }),
    };
    const registry = {
      all: jest.fn().mockReturnValue([{ queue: 'test.queue' }]),
    };
    const worker = new BackgroundJobWorker(
      queue as unknown as BackgroundJobQueue,
      {} as RequestContextStorage,
      registry as unknown as JobProcessorRegistry,
      {} as never,
      {} as never,
    );

    const tick = worker.tick();
    await claimStarted;
    let stopped = false;
    const shutdown = worker.onModuleDestroy().then(() => {
      stopped = true;
    });
    await Promise.resolve();

    expect(stopped).toBe(false);
    expect(await worker.tick()).toBe(0);
    release?.();
    await expect(tick).resolves.toBe(0);
    await shutdown;
    expect(stopped).toBe(true);
    expect(queue.claim).toHaveBeenCalledTimes(1);
  });
});
