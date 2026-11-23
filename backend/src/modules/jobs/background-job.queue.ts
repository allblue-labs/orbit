import { TENANT_DEFER_MS } from '../tenant-operations/tenant-operation.policy';
/**
 * Fila sobre Postgres.
 *
 * ## Reivindicação sem corrida
 *
 * ```sql
 * UPDATE background_jobs SET status = 'RUNNING' …
 * WHERE id = (
 *   SELECT id FROM background_jobs
 *   WHERE queue = $1 AND status = 'PENDING' AND available_at <= now()
 *   ORDER BY available_at
 *   FOR UPDATE SKIP LOCKED
 *   LIMIT 1
 * )
 * ```
 *
 * `SKIP LOCKED` faz cada réplica pegar um job diferente sem bloquear as outras.
 * É o mecanismo que uma fila dedicada implementaria por dentro.
 *
 * ## Reivindicar é um ato de escalonador
 *
 * Descobrir de quem é o próximo job é o **objetivo** da consulta — não dá para
 * declarar a organização antes de saber qual é. Com o papel restrito da PR-26.6
 * isso deixou de ser detalhe: `background_jobs` isola por organização, e uma
 * consulta sem contexto passou a devolver zero linha.
 *
 * A saída é um predicado próprio, `app.job_worker`, declarado **apenas** pelos
 * métodos que operam o ciclo de vida da fila. Ele aparece em uma única política
 * — a de `background_jobs` — e não abre nenhuma outra tabela: não é
 * administrador da plataforma, e não é elevação de privilégio para contornar a
 * RLS de dados. A partir do `claim`, todo o trabalho roda dentro do contexto do
 * tenant dono do job, com a mesma RLS de uma requisição. Ver
 * `background-job.worker.ts`.
 *
 * Enfileirar é diferente: acontece dentro de uma requisição (ou de um job já em
 * contexto), então usa a transação do tenant e passa pela política normal.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { generateUuidV7 } from '../../utils';
import type {
  BackgroundJobRecord,
  EnqueueJobInput,
  JobQueue,
} from './background-job.types';
import {
  backoffDelay,
  groupOf,
  type BackoffPolicy,
  type QueueGroupConfig,
} from './queue-groups';

/** Backoff exponencial com teto — 5s, 10s, 20s, 40s… até 5 minutos. */
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_CEILING_MS = 300_000;

/**
 * O backoff padrão, também usado pelos outboxes de e-mail. As filas usam a
 * política do próprio grupo (`queue-groups.ts`).
 */
export function backoffFor(
  attempts: number,
  policy: BackoffPolicy = {
    baseMs: BACKOFF_BASE_MS,
    ceilingMs: BACKOFF_CEILING_MS,
  },
): number {
  return backoffDelay(attempts, policy);
}

interface JobRow {
  id: string;
  queue: string;
  job_key: string;
  organization_id: string;
  business_unit_id: string | null;
  scope: string;
  business_unit_ids: string[];
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  correlation_id: string;
  actor_user_id: string | null;
  last_error: string | null;
  locked_by: string | null;
  available_at: Date;
  created_at: Date;
}

/** As colunas que `fromRow` espera, em uma lista só — usada por dois RETURNING. */
const JOB_COLUMNS = Prisma.sql`
  id, queue, job_key, organization_id, business_unit_id, scope,
  business_unit_ids, payload, status, attempts, max_attempts,
  correlation_id, actor_user_id, last_error, locked_by, available_at, created_at
`;

@Injectable()
export class BackgroundJobQueue {
  private readonly logger = new Logger(BackgroundJobQueue.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
  ) {}

  /**
   * Uma transação em que o worker opera a **fila**, e nada além dela.
   *
   * `app.job_worker` é local à transação (`set_config(..., true)`): sai de cena
   * no commit. Nenhuma outra política do banco consulta este ajuste.
   */
  private asWorker<T>(
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT set_config($1, $2, true)',
        'app.job_worker',
        'true',
      );
      return work(tx);
    });
  }

  /**
   * Enfileira, ou devolve o job já pendente com a mesma chave.
   *
   * A idempotência é do **banco**: um índice único parcial sobre
   * `(queue, job_key)` enquanto o status é `PENDING` ou `RUNNING`. Duas
   * requisições simultâneas não criam dois jobs — a segunda colide e lê a
   * primeira.
   *
   * ## Enfileirar dentro da transação de quem pediu
   *
   * `client` recebe a transação do chamador quando o job **só faz sentido se o
   * fato de negócio existir** — e vice-versa. Sem isso o enfileiramento
   * acontece depois do commit, e um processo que morre entre os dois deixa o
   * fato gravado e o trabalho nunca pedido: perda silenciosa, do tipo que
   * ninguém descobre porque nada falhou. Com a transação, é padrão outbox — ou
   * os dois existem, ou nenhum.
   */
  async enqueue(
    input: EnqueueJobInput,
    client?: PrismaTransactionClient,
  ): Promise<BackgroundJobRecord> {
    if (client) return this.enqueueWithin(client, input);
    /**
     * Sem transação do chamador, abre a **do tenant**.
     *
     * Antes usava o cliente direto, o que funcionava só porque o papel do banco
     * contornava a RLS: `background_jobs` isola por organização, e um `INSERT`
     * sem contexto viola a política. Quem enfileira sempre tem contexto — é uma
     * requisição HTTP ou um job já reaberto pelo worker.
     */
    return this.rls.run((tx) => this.enqueueWithin(tx, input));
  }

  /** A unidade singular gravada na linha — nula em escopo organizacional. */
  private unitOf(input: EnqueueJobInput): string | null {
    return input.scope === 'BUSINESS_UNIT' ? input.businessUnitId : null;
  }

  /** As unidades declaradas ao Postgres quando este job rodar. */
  private unitsOf(input: EnqueueJobInput): string[] {
    return input.scope === 'BUSINESS_UNIT'
      ? [input.businessUnitId]
      : [...input.businessUnitIds];
  }

  /**
   * Insere dentro de uma transação em curso.
   *
   * Aqui **não** se captura `P2002`: no Postgres uma violação de unicidade
   * aborta a transação inteira, e a leitura de recuperação falharia com
   * "current transaction is aborted". `ON CONFLICT DO NOTHING` evita o erro em
   * vez de tratá-lo — sem alvo declarado, cobre o índice parcial que define a
   * idempotência da fila. Nada retornado significa que a chave já está na
   * fila, e aí o job existente é lido normalmente.
   */
  private async enqueueWithin(
    client: PrismaTransactionClient,
    input: EnqueueJobInput,
  ): Promise<BackgroundJobRecord> {
    const inserted = await client.$queryRaw<JobRow[]>`
      INSERT INTO background_jobs (
        id, organization_id, business_unit_id, scope, business_unit_ids,
        queue, job_key, payload,
        correlation_id, actor_user_id, max_attempts, available_at, updated_at
      ) VALUES (
        ${generateUuidV7()}::uuid,
        ${input.organizationId}::uuid,
        ${this.unitOf(input)}::uuid,
        ${input.scope},
        ${this.unitsOf(input)}::uuid[],
        ${input.queue},
        ${input.jobKey},
        ${JSON.stringify(input.payload)}::jsonb,
        ${input.correlationId},
        ${input.actorUserId ?? null}::uuid,
        ${input.maxAttempts ?? groupOf(input.queue).maxAttempts},
        COALESCE(${input.availableAt ?? null}::timestamptz, now()),
        now()
      )
      ON CONFLICT DO NOTHING
      RETURNING ${JOB_COLUMNS}
    `;

    const row = inserted[0];
    if (row) return this.fromRow(row);

    /*
     * Idempotência permanente (grupo fiscal): a chave colide também com um job
     * já concluído, e é ele que volta — a nota emitida não é pedida de novo.
     */
    const permanent = groupOf(input.queue).idempotency === 'permanent';
    const existing = await client.backgroundJob.findFirst({
      where: {
        queue: input.queue,
        jobKey: input.jobKey,
        ...(permanent
          ? { organizationId: input.organizationId, status: { not: 'DEAD' } }
          : { status: { in: ['PENDING', 'RUNNING'] } }),
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing) {
      throw new Error(
        `[jobs] enfileiramento recusado sem job correspondente: ${input.queue}/${input.jobKey}`,
      );
    }
    return this.toRecord(existing);
  }

  /**
   * Reivindica o próximo job de um grupo, com justiça entre organizações.
   *
   * ## A ordem
   *
   * Entre os pendentes elegíveis das filas do grupo, vence o da organização
   * com **menos jobs rodando** no grupo; empatadas, a ordem de chegada. Uma
   * organização com trezentos relatórios na fila disputa a próxima vaga com a
   * vizinha que pediu um — e perde enquanto já tiver um rodando.
   *
   * ## O teto
   *
   * Uma organização com `perOrganizationLimit` jobs rodando no grupo não
   * reivindica mais nenhum, somando todas as réplicas. Os jobs dela esperam
   * na fila; os das outras passam.
   *
   * ## Por que a trava consultiva
   *
   * Sem ela, duas réplicas leem "1 rodando" no mesmo instante e as duas
   * reivindicam — o teto de 2 vira 3. `pg_advisory_xact_lock` por grupo
   * serializa só o instante do claim (milissegundos), não a execução, e sai
   * com o commit.
   *
   * ## Limite de taxa (grupo `ai`)
   *
   * Conta os jobs que **começaram** na janela, por organização e no total.
   * Nos grupos com limite de taxa, `started_at` é renovado a cada tentativa:
   * repetir uma chamada ao provedor também gasta a cota.
   */
  async claim(
    group: QueueGroupConfig,
    queues: readonly JobQueue[],
    worker: string,
  ): Promise<BackgroundJobRecord | null> {
    if (!queues.length) return null;
    const rate = group.rateLimit;
    const row = await this.asWorker(async (tx) => {
      /* `$executeRaw`: a função devolve `void`, que `$queryRaw` não lê. */
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${'orbit:jobs:claim:' + group.name}, 0))
      `;
      const rateFilter = rate
        ? Prisma.sql`
            AND COALESCE(s.n, 0) < ${rate.perOrganization.max}
            AND (SELECT COALESCE(sum(n), 0) FROM started) < ${rate.global.max}`
        : Prisma.empty;
      const rows = await tx.$queryRaw<JobRow[]>`
        WITH running AS (
          SELECT organization_id, count(*)::int AS n
            FROM background_jobs
           WHERE queue IN (${Prisma.join(queues)}) AND status = 'RUNNING'
           GROUP BY organization_id
        ), started AS (
          SELECT organization_id, count(*)::int AS n
            FROM background_jobs
           WHERE queue IN (${Prisma.join(queues)})
             AND started_at > now() - ${rate?.perOrganization.windowMs ?? 0} * interval '1 millisecond'
             AND ${rate ? Prisma.sql`true` : Prisma.sql`false`}
           GROUP BY organization_id
        ), candidate AS (
          SELECT j.id
            FROM background_jobs j
            LEFT JOIN running r ON r.organization_id = j.organization_id
            LEFT JOIN started s ON s.organization_id = j.organization_id
           WHERE j.queue IN (${Prisma.join(queues)})
             AND j.status = 'PENDING'
             AND j.available_at <= now()
             AND COALESCE(r.n, 0) < ${group.perOrganizationLimit}
             ${rateFilter}
           ORDER BY COALESCE(r.n, 0) ASC, j.available_at ASC, j.created_at ASC
           FOR UPDATE OF j SKIP LOCKED
           LIMIT 1
        )
        UPDATE background_jobs
           SET status = 'RUNNING',
               attempts = attempts + 1,
               locked_at = now(),
               locked_by = ${worker},
               started_at = CASE WHEN ${rate ? Prisma.sql`true` : Prisma.sql`false`}
                                 THEN now() ELSE COALESCE(started_at, now()) END,
               updated_at = now()
         WHERE id = (SELECT id FROM candidate)
         RETURNING ${JOB_COLUMNS}
      `;
      return rows[0] ?? null;
    });

    return row ? this.fromRow(row) : null;
  }

  /** Deliberate policy deferral does not consume a processor attempt or dead-letter the job. */
  async defer(
    job: BackgroundJobRecord,
    reason:
      | 'ORGANIZATION_SUSPENDED'
      | 'ORGANIZATION_UNAVAILABLE'
      | 'SUBSCRIPTION_NOT_ACTIVE',
  ): Promise<void> {
    await this.asWorker((tx) =>
      tx.backgroundJob.updateMany({
        where: this.lease(job),
        data: {
          status: 'PENDING',
          attempts: { decrement: 1 },
          availableAt: new Date(Date.now() + TENANT_DEFER_MS),
          lockedAt: null,
          lockedBy: null,
          lastError: reason,
        },
      }),
    );
    this.logger.log(
      JSON.stringify({
        jobId: job.id,
        organizationId: job.organizationId,
        correlationId: job.correlationId,
        outcome: 'DEFERRED',
        reason,
      }),
    );
  }

  private lease(job: BackgroundJobRecord) {
    if (!job.lockedBy) throw new Error('Job lease is missing');
    return { id: job.id, status: 'RUNNING', lockedBy: job.lockedBy };
  }

  async heartbeat(job: BackgroundJobRecord): Promise<void> {
    await this.asWorker((tx) =>
      tx.backgroundJob.updateMany({
        where: this.lease(job),
        data: { lockedAt: new Date() },
      }),
    );
  }

  async succeed(job: BackgroundJobRecord): Promise<boolean> {
    const result = await this.asWorker((tx) =>
      tx.backgroundJob.updateMany({
        where: this.lease(job),
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      }),
    );
    return result.count === 1;
  }

  /**
   * Registra a falha e decide entre repetir e enterrar.
   *
   * `permanent` pula o retry: payload inválido não melhora na terceira
   * tentativa. Esgotadas as tentativas, o job vai para `DEAD` — que é o
   * dead-letter desta fila: permanece na tabela, com o último erro, para ser
   * investigado.
   */
  async fail(
    job: BackgroundJobRecord,
    failureCode: string,
    permanent = false,
  ): Promise<'RETRY' | 'DEAD' | 'LEASE_LOST'> {
    const exhausted = permanent || job.attempts >= job.maxAttempts;
    const delay = backoffFor(job.attempts, groupOf(job.queue).backoff);
    const safeFailureCode = /^[A-Z0-9_.:-]{1,160}$/.test(failureCode)
      ? failureCode
      : 'UNCLASSIFIED_FAILURE';

    const result = await this.asWorker((tx) =>
      tx.backgroundJob.updateMany({
        where: this.lease(job),
        data: {
          status: exhausted ? 'DEAD' : 'PENDING',
          availableAt: exhausted ? undefined : new Date(Date.now() + delay),
          lockedAt: null,
          lockedBy: null,
          finishedAt: exhausted ? new Date() : null,
          // A fila nunca persiste mensagem de exceção arbitrária: provider
          // errors can carry URLs, tokens or customer data. Diagnostics use a
          // bounded server-owned category instead.
          lastError: safeFailureCode,
        },
      }),
    );

    if (result.count !== 1) return 'LEASE_LOST';

    this.logger.warn(
      JSON.stringify({
        queue: job.queue,
        jobId: job.id,
        correlationId: job.correlationId,
        attempt: job.attempts,
        maxAttempts: job.maxAttempts,
        outcome: exhausted ? 'DEAD' : 'RETRY',
        retryInMs: exhausted ? null : delay,
        failureCode: safeFailureCode,
      }),
    );

    return exhausted ? 'DEAD' : 'RETRY';
  }

  /**
   * Devolve jobs presos.
   *
   * Um processo derrubado no meio do trabalho deixa o job `RUNNING` para
   * sempre. Depois do tempo limite, ele volta para a fila — e é por isso que
   * todo processador precisa ser idempotente.
   */
  async requeueStalled(queue: JobQueue, olderThanMs: number): Promise<number> {
    const count = await this.asWorker(
      (tx) => tx.$executeRaw`
      UPDATE background_jobs
         SET status = CASE WHEN attempts >= max_attempts THEN 'DEAD' ELSE 'PENDING' END,
             finished_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
             available_at = now(), locked_at = NULL, locked_by = NULL,
             last_error = 'JOB_LEASE_EXPIRED', updated_at = now()
       WHERE id IN (
         SELECT id FROM background_jobs
          WHERE queue = ${queue} AND status = 'RUNNING'
            AND locked_at < now() - ${olderThanMs} * interval '1 millisecond'
          ORDER BY locked_at LIMIT 50 FOR UPDATE SKIP LOCKED
       )
    `,
    );
    if (count)
      this.logger.warn(
        JSON.stringify({ event: 'job_leases_expired', queue, count }),
      );
    return count;
  }

  snapshot(queues: readonly JobQueue[]) {
    if (!queues.length) return Promise.resolve([]);
    return this.asWorker(
      (tx) => tx.$queryRaw<
        {
          queue: string;
          ready: number;
          running: number;
          dead: number;
          oldest_ready_ms: number;
        }[]
      >`
      SELECT queue,
             count(*) FILTER (WHERE status = 'PENDING' AND available_at <= now())::int AS ready,
             count(*) FILTER (WHERE status = 'RUNNING')::int AS running,
             count(*) FILTER (WHERE status = 'DEAD')::int AS dead,
             COALESCE(extract(epoch FROM now() - min(available_at)
               FILTER (WHERE status = 'PENDING' AND available_at <= now())) * 1000, 0)::double precision AS oldest_ready_ms
        FROM background_jobs
       WHERE queue IN (${Prisma.join(queues)})
         AND status IN ('PENDING', 'RUNNING', 'DEAD')
       GROUP BY queue
    `,
    );
  }

  deadLetters(queue: JobQueue) {
    return this.asWorker((tx) =>
      tx.backgroundJob.findMany({
        where: { status: 'DEAD', queue },
        select: {
          id: true,
          queue: true,
          attempts: true,
          lastError: true,
          finishedAt: true,
        },
        orderBy: { finishedAt: 'desc' },
        take: 100,
      }),
    );
  }

  /** Preserve original scope, identity, failure code and attempt history. */
  async replayDead(id: string, queue: JobQueue): Promise<boolean> {
    // Only processors with durable reconciliation are eligible for manual replay.
    if (queue !== 'artifact.render' && queue !== 'management-report.generate')
      return false;
    try {
      const count = await this.asWorker(
        (tx) => tx.$executeRaw`
        UPDATE background_jobs dead
           SET status = 'PENDING', available_at = now(), max_attempts = dead.attempts + 1,
               locked_at = NULL, locked_by = NULL, finished_at = NULL, updated_at = now()
         WHERE dead.id = ${id}::uuid AND dead.queue = ${queue} AND dead.status = 'DEAD'
           AND (dead.last_error = 'JOB_LEASE_EXPIRED' OR dead.last_error = 'INTERNAL_ERROR:INFRASTRUCTURE_ERROR' OR
                split_part(dead.last_error, ':', 1) IN ('DATABASE_UNAVAILABLE', 'DATABASE_TIMEOUT', 'CONNECTION_FAILURE'))
           AND NOT EXISTS (
             SELECT 1 FROM background_jobs other
              WHERE other.queue = dead.queue AND other.job_key = dead.job_key
                AND other.id <> dead.id
                AND (other.status IN ('PENDING','RUNNING') OR other.created_at >= dead.created_at)
           )
      `,
      );
      return count === 1;
    } catch (error) {
      // Concurrent enqueue or replay is protected by the active job unique index.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2010' &&
        error.meta?.code === '23505'
      )
        return false;
      throw error;
    }
  }

  find(id: string) {
    return this.asWorker((tx) =>
      tx.backgroundJob.findUnique({ where: { id } }),
    );
  }

  private toRecord(job: {
    id: string;
    queue: string;
    jobKey: string;
    organizationId: string;
    businessUnitId: string | null;
    scope: string;
    businessUnitIds: string[];
    payload: Prisma.JsonValue;
    status: string;
    attempts: number;
    maxAttempts: number;
    correlationId: string;
    actorUserId: string | null;
    lastError: string | null;
    lockedBy: string | null;
    availableAt: Date;
    createdAt: Date;
  }): BackgroundJobRecord {
    return {
      id: job.id,
      queue: job.queue,
      jobKey: job.jobKey,
      organizationId: job.organizationId,
      businessUnitId: job.businessUnitId,
      scope: job.scope as BackgroundJobRecord['scope'],
      businessUnitIds: job.businessUnitIds,
      payload: (job.payload ?? {}) as Record<string, unknown>,
      status: job.status as BackgroundJobRecord['status'],
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      correlationId: job.correlationId,
      actorUserId: job.actorUserId,
      lastError: job.lastError,
      lockedBy: job.lockedBy,
      availableAt: job.availableAt,
      createdAt: job.createdAt,
    };
  }

  private fromRow(row: JobRow): BackgroundJobRecord {
    return {
      id: row.id,
      queue: row.queue,
      jobKey: row.job_key,
      organizationId: row.organization_id,
      businessUnitId: row.business_unit_id,
      scope: row.scope as BackgroundJobRecord['scope'],
      businessUnitIds: row.business_unit_ids ?? [],
      payload: row.payload ?? {},
      status: row.status as BackgroundJobRecord['status'],
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      correlationId: row.correlation_id,
      actorUserId: row.actor_user_id,
      lastError: row.last_error,
      lockedBy: row.locked_by,
      availableAt: row.available_at,
      createdAt: row.created_at,
    };
  }
}
