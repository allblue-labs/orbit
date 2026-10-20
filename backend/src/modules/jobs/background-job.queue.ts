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

/** Backoff exponencial com teto — 5s, 10s, 20s, 40s… até 5 minutos. */
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_CEILING_MS = 300_000;

export function backoffFor(attempts: number): number {
  return Math.min(
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1),
    BACKOFF_CEILING_MS,
  );
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
  available_at: Date;
  created_at: Date;
}

/** As colunas que `fromRow` espera, em uma lista só — usada por dois RETURNING. */
const JOB_COLUMNS = Prisma.sql`
  id, queue, job_key, organization_id, business_unit_id, scope,
  business_unit_ids, payload, status, attempts, max_attempts,
  correlation_id, actor_user_id, last_error, available_at, created_at
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
        ${input.maxAttempts ?? 3},
        COALESCE(${input.availableAt ?? null}::timestamptz, now()),
        now()
      )
      ON CONFLICT DO NOTHING
      RETURNING ${JOB_COLUMNS}
    `;

    const row = inserted[0];
    if (row) return this.fromRow(row);

    const existing = await client.backgroundJob.findFirst({
      where: {
        queue: input.queue,
        jobKey: input.jobKey,
        status: { in: ['PENDING', 'RUNNING'] },
      },
    });
    if (!existing) {
      throw new Error(
        `[jobs] enfileiramento recusado sem job correspondente: ${input.queue}/${input.jobKey}`,
      );
    }
    return this.toRecord(existing);
  }

  /** Reivindica um job elegível, ou `null` quando não há trabalho. */
  async claim(
    queue: JobQueue,
    worker: string,
  ): Promise<BackgroundJobRecord | null> {
    const row = await this.asWorker(async (tx) => {
      const rows = await tx.$queryRaw<JobRow[]>`
        UPDATE background_jobs
           SET status = 'RUNNING',
               attempts = attempts + 1,
               locked_at = now(),
               locked_by = ${worker},
               started_at = COALESCE(started_at, now()),
               updated_at = now()
         WHERE id = (
           SELECT id FROM background_jobs
            WHERE queue = ${queue}
              AND status = 'PENDING'
              AND available_at <= now()
            ORDER BY available_at ASC, created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         RETURNING ${JOB_COLUMNS}
      `;
      return rows[0] ?? null;
    });

    return row ? this.fromRow(row) : null;
  }

  async succeed(id: string): Promise<void> {
    await this.asWorker((tx) =>
      tx.backgroundJob.update({
        where: { id },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      }),
    );
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
  ): Promise<'RETRY' | 'DEAD'> {
    const exhausted = permanent || job.attempts >= job.maxAttempts;
    const delay = backoffFor(job.attempts);
    const safeFailureCode = /^[A-Z0-9_.:-]{1,160}$/.test(failureCode)
      ? failureCode
      : 'UNCLASSIFIED_FAILURE';

    await this.asWorker((tx) =>
      tx.backgroundJob.update({
        where: { id: job.id },
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
    const threshold = new Date(Date.now() - olderThanMs);
    const result = await this.asWorker((tx) =>
      tx.backgroundJob.updateMany({
        where: { queue, status: 'RUNNING', lockedAt: { lt: threshold } },
        data: { status: 'PENDING', lockedAt: null, lockedBy: null },
      }),
    );
    if (result.count > 0) {
      this.logger.warn(
        `[jobs] ${result.count} job(s) presos em ${queue} devolvidos à fila`,
      );
    }
    return result.count;
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
      availableAt: row.available_at,
      createdAt: row.created_at,
    };
  }
}
