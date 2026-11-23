import type { RequestContextStorage } from '../../context';
import type { BackgroundJobQueue } from './background-job.queue';
import {
  JOB_QUEUES,
  type BackgroundJobRecord,
  type JobProcessor,
} from './background-job.types';
import { BackgroundJobWorker } from './background-job.worker';
import type { JobProcessorRegistry } from './job-processor.registry';
import { QUEUE_GROUPS } from './queue-groups';

function job(
  queue: string,
  overrides: Partial<BackgroundJobRecord> = {},
): BackgroundJobRecord {
  return {
    id: `job-${Math.random()}`,
    queue,
    jobKey: 'k',
    organizationId: 'org-a',
    businessUnitId: 'unit-a',
    scope: 'BUSINESS_UNIT',
    businessUnitIds: ['unit-a'],
    payload: {},
    status: 'RUNNING',
    attempts: 1,
    maxAttempts: 3,
    correlationId: 'corr',
    actorUserId: null,
    lastError: null,
    lockedBy: 'lease',
    availableAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function build(queue: Record<string, jest.Mock>, processors: JobProcessor[]) {
  const registry = { all: jest.fn().mockReturnValue(processors) };
  const storage = {
    run: (_context: unknown, work: () => unknown) => work(),
  };
  const operational = {
    snapshot: jest.fn().mockResolvedValue({ operational: true }),
  };
  const plans = {
    getEntitlements: jest.fn().mockResolvedValue({}),
    grantsAccess: jest.fn().mockReturnValue(true),
  };
  return new BackgroundJobWorker(
    {
      requeueStalled: jest.fn().mockResolvedValue(0),
      heartbeat: jest.fn().mockResolvedValue(undefined),
      succeed: jest.fn().mockResolvedValue(true),
      fail: jest.fn().mockResolvedValue('RETRY'),
      ...queue,
    } as unknown as BackgroundJobQueue,
    storage as unknown as RequestContextStorage,
    registry as unknown as JobProcessorRegistry,
    operational as never,
    plans as never,
  );
}

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
    const claim = jest.fn().mockImplementation(() => {
      claimed();
      return blocked.then(() => null);
    });
    const worker = build({ claim }, [
      { queue: JOB_QUEUES.automationAction, process: jest.fn() },
    ]);

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
    expect(claim).toHaveBeenCalledTimes(1);
  });
});

describe('BackgroundJobWorker pool', () => {
  it('ocupa as vagas do grupo e reivindica pelo grupo, com as filas que sabe processar', async () => {
    const jobs = [
      job(JOB_QUEUES.mobilePushDelivery),
      job(JOB_QUEUES.mobilePushDelivery),
      job(JOB_QUEUES.mobileNotification),
    ];
    const claim = jest
      .fn()
      .mockImplementation(() => Promise.resolve(jobs.shift() ?? null));
    const process = jest.fn().mockResolvedValue(undefined);
    const worker = build({ claim }, [
      { queue: JOB_QUEUES.mobilePushDelivery, process },
      { queue: JOB_QUEUES.mobileNotification, process },
    ]);

    await expect(worker.tick()).resolves.toBe(3);
    expect(process).toHaveBeenCalledTimes(3);
    const [group, queues] = claim.mock.calls[0] as [{ name: string }, string[]];
    expect(group.name).toBe('comms');
    expect(queues.sort()).toEqual(
      [JOB_QUEUES.mobileNotification, JOB_QUEUES.mobilePushDelivery].sort(),
    );
  });

  it('não passa da concorrência do grupo', async () => {
    const limit = QUEUE_GROUPS.core.concurrency;
    const claim = jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(job(JOB_QUEUES.automationAction)),
      );
    let running = 0;
    let peak = 0;
    const process = jest.fn().mockImplementation(async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    });
    const worker = build({ claim }, [
      { queue: JOB_QUEUES.automationAction, process },
    ]);

    await expect(worker.tick()).resolves.toBe(limit);
    expect(peak).toBe(limit);
  });
});

describe('BackgroundJobWorker timeout', () => {
  afterEach(() => jest.useRealTimers());

  it('aborta o sinal e devolve o job com JOB_TIMEOUT quando estoura o tempo do grupo', async () => {
    jest.useFakeTimers();
    const claimed = job(JOB_QUEUES.automationAction);
    const claim = jest
      .fn()
      .mockResolvedValueOnce(claimed)
      .mockResolvedValue(null);
    const fail = jest.fn().mockResolvedValue('RETRY');
    const succeed = jest.fn().mockResolvedValue(true);
    let received: AbortSignal | undefined;
    const process = jest
      .fn()
      .mockImplementation((_job: BackgroundJobRecord, signal: AbortSignal) => {
        received = signal;
        return new Promise(() => undefined);
      });
    const worker = build({ claim, fail, succeed }, [
      { queue: JOB_QUEUES.automationAction, process },
    ]);

    const tick = worker.tick();
    await jest.advanceTimersByTimeAsync(QUEUE_GROUPS.core.timeoutMs);
    await expect(tick).resolves.toBe(1);

    expect(received?.aborted).toBe(true);
    expect(fail).toHaveBeenCalledWith(claimed, 'JOB_TIMEOUT', false);
    expect(succeed).not.toHaveBeenCalled();
  });
});
