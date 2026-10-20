/**
 * Política de retry e backoff.
 *
 * O que é testável sem banco: a curva do backoff e a decisão entre repetir e
 * enterrar. A reivindicação concorrente (`SKIP LOCKED`) e a idempotência por
 * índice único são propriedades do **Postgres** — estão no E2E, contra o banco
 * de verdade, porque um teste com banco falso provaria apenas que o falso
 * concorda com o teste.
 */
import {
  BACKOFF_CEILING_MS,
  BackgroundJobQueue,
  backoffFor,
} from './background-job.queue';
import type { BackgroundJobRecord } from './background-job.types';

describe('backoffFor', () => {
  it('dobra a cada tentativa', () => {
    expect(backoffFor(1)).toBe(5_000);
    expect(backoffFor(2)).toBe(10_000);
    expect(backoffFor(3)).toBe(20_000);
    expect(backoffFor(4)).toBe(40_000);
  });

  it('para de crescer no teto — espera não vira abandono', () => {
    expect(backoffFor(20)).toBe(BACKOFF_CEILING_MS);
    expect(backoffFor(100)).toBe(BACKOFF_CEILING_MS);
  });

  it('trata tentativa zero como a primeira', () => {
    expect(backoffFor(0)).toBe(5_000);
  });
});

describe('BackgroundJobQueue.fail', () => {
  const job = (
    overrides: Partial<BackgroundJobRecord> = {},
  ): BackgroundJobRecord => ({
    id: '019f-job',
    queue: 'artifact.render',
    jobKey: '019f-exec',
    organizationId: '019f-org',
    businessUnitId: '019f-unit',
    scope: 'BUSINESS_UNIT',
    businessUnitIds: ['019f-unit'],
    payload: {},
    status: 'RUNNING',
    attempts: 1,
    maxAttempts: 3,
    correlationId: '019f-corr',
    actorUserId: '019f-user',
    lastError: null,
    availableAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  });

  /**
   * O cliente falso precisa de `$transaction` porque `fail` fecha o job pela
   * transação que declara `app.job_worker` — sem ela, a política de
   * `background_jobs` recusaria a escrita sob o papel restrito.
   */
  const build = () => {
    const updates: Record<string, unknown>[] = [];
    const settings: string[] = [];
    const tx = {
      $queryRawUnsafe: (_sql: string, key: string) => {
        settings.push(key);
        return Promise.resolve([]);
      },
      backgroundJob: {
        update: (args: { data: Record<string, unknown> }) => {
          updates.push(args.data);
          return Promise.resolve({});
        },
      },
    };
    const prisma = {
      $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    };
    return {
      updates,
      settings,
      queue: new BackgroundJobQueue(
        prisma as unknown as ConstructorParameters<
          typeof BackgroundJobQueue
        >[0],
        {} as unknown as ConstructorParameters<typeof BackgroundJobQueue>[1],
      ),
    };
  };

  it('fecha o job pela transação que declara o worker', async () => {
    const { queue, settings } = build();

    await queue.fail(job(), 'TRANSIENT_ERROR');

    expect(settings).toEqual(['app.job_worker']);
  });

  it('devolve o job à fila enquanto restam tentativas', async () => {
    const { queue, updates } = build();

    const outcome = await queue.fail(job({ attempts: 1 }), 'TIMEOUT');

    expect(outcome).toBe('RETRY');
    expect(updates[0]!.status).toBe('PENDING');
    expect(updates[0]!.availableAt).toBeInstanceOf(Date);
    expect(updates[0]!.finishedAt).toBeNull();
  });

  it('enterra quando as tentativas se esgotam', async () => {
    const { queue, updates } = build();

    const outcome = await queue.fail(job({ attempts: 3 }), 'RETRY_EXHAUSTED');

    expect(outcome).toBe('DEAD');
    expect(updates[0]!.status).toBe('DEAD');
    expect(updates[0]!.finishedAt).toBeInstanceOf(Date);
    /** Sem `availableAt`: um job morto não volta sozinho. */
    expect(updates[0]!.availableAt).toBeUndefined();
  });

  it('erro permanente não gasta as tentativas restantes', async () => {
    const { queue, updates } = build();

    const outcome = await queue.fail(
      job({ attempts: 1 }),
      'PAYLOAD_INVALID',
      true,
    );

    expect(outcome).toBe('DEAD');
    expect(updates[0]!.status).toBe('DEAD');
  });

  it('never persists an arbitrary failure message', async () => {
    const { queue, updates } = build();

    await queue.fail(
      job(),
      'provider failed with token SENSITIVE_JOB_SECRET_MUST_NOT_LEAK',
    );

    expect(updates[0]!.lastError).toBe('UNCLASSIFIED_FAILURE');
    expect(JSON.stringify(updates)).not.toContain(
      'SENSITIVE_JOB_SECRET_MUST_NOT_LEAK',
    );
  });

  it('libera a trava para outra réplica poder pegar', async () => {
    const { queue, updates } = build();

    await queue.fail(job(), 'TRANSIENT_ERROR');

    expect(updates[0]!.lockedAt).toBeNull();
    expect(updates[0]!.lockedBy).toBeNull();
  });
});
