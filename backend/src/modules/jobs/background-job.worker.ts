import {
  CONTINUING_QUEUES,
  TenantOperationPolicy,
} from '../tenant-operations/tenant-operation.policy';
import { SubscriptionPlanService } from '../subscription-plans/subscription-plan.service';
/**
 * Worker de jobs.
 *
 * Cada grupo de filas reivindica um job por vez. O processador roda no contexto
 * do tenant dono do job e o resultado é fechado pelo detentor do lease.
 *
 * ## RLS no trabalho de fundo
 *
 * Este é o ponto delicado. O worker não atende requisição, então não há
 * `RequestContext` — e sem ele a `RlsTransaction` não sabe qual organização
 * declarar ao Postgres.
 *
 * A solução **não** é rodar como administrador da plataforma: isso desligaria o
 * isolamento justamente no caminho que roda sem ninguém olhando. O job carrega
 * organização, escopo e ator, e o worker reabre exatamente esse contexto com
 * `RequestContextStorage.run`. A política do banco é a mesma da requisição que
 * enfileirou.
 *
 * ## Escopo vem do job, não de uma dedução
 *
 * Até a PR-26.6 o worker montava `businessUnitIds` como `[job.businessUnitId]`
 * ou, na falta dela, `[]`. Sob papel restrito isso é catastrófico e silencioso:
 * `app.business_unit_ids` vazio faz toda tabela recortada por unidade devolver
 * zero linha, e o relatório de organização inteira fecha `READY` com números
 * zerados. Agora o job declara o escopo — `BUSINESS_UNIT` com a unidade, ou
 * `ORGANIZATION` com a lista resolvida no pedido — e um escopo vazio **falha**
 * em vez de produzir um retrato de nada.
 *
 * ## Desligável
 *
 * `JOBS_WORKER_ENABLED=false` desliga o laço sem tirar a fila do ar — é como o
 * E2E controla o momento de processar, e como uma réplica pode ficar só
 * atendendo HTTP.
 */
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { rmSync, writeFileSync } from 'node:fs';
import { processRole } from '../../runtime/process-role';
import { withPdfBudget } from '../../runtime/pdf-thread';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import type { UUID } from '../../contracts';
import { RequestContext, RequestContextStorage } from '../../context';
import { classifyInternalError } from '../../errors';
import { captureOrbitError } from '../../observability/sentry';
import { generateUuidV7 } from '../../utils';
import { BackgroundJobQueue } from './background-job.queue';
import {
  JobTimeoutError,
  PermanentJobError,
  type BackgroundJobRecord,
  type JobProcessor,
  type JobQueue,
} from './background-job.types';
import { JobProcessorRegistry } from './job-processor.registry';
import {
  groupOf,
  QUEUE_GROUPS,
  type QueueGroupConfig,
  type QueueGroupName,
} from './queue-groups';

/** Tempo após o qual um job `RUNNING` é considerado abandonado. */
const STALLED_AFTER_MS = 5 * 60_000;

@Injectable()
export class BackgroundJobWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackgroundJobWorker.name);
  private readonly eventLoop = monitorEventLoopDelay({ resolution: 20 });
  private lastSample = -Infinity;
  private sampling: Promise<void> | null = null;
  private lastSweep = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private activeTick: Promise<number> | null = null;
  private stopping = false;
  /** Jobs em execução, por grupo. O tamanho de cada conjunto é a vaga ocupada. */
  private readonly inflight = new Map<QueueGroupName, Set<Promise<void>>>();
  private pumping: Promise<void> | null = null;

  constructor(
    private readonly queue: BackgroundJobQueue,
    private readonly storage: RequestContextStorage,
    private readonly registry: JobProcessorRegistry,
    private readonly operational: TenantOperationPolicy,
    private readonly plans: SubscriptionPlanService,
  ) {}

  onModuleInit(): void {
    if (
      processRole() === 'api' ||
      (process.env.JOBS_WORKER_ENABLED ?? 'true').trim() === 'false'
    ) {
      this.logger.log('[jobs] worker desligado por configuração');
      return;
    }
    const interval = Number(process.env.JOBS_POLL_INTERVAL_MS ?? 2000);
    this.timer = setInterval(
      () => void this.pump(),
      Number.isFinite(interval) ? Math.max(250, interval) : 2000,
    );
    this.eventLoop.enable();
    if (processRole() !== 'combined')
      rmSync('/tmp/orbit-worker-ready', { force: true });
    if (processRole() === 'combined') this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    /**
     * `clearInterval` impede novos claims, mas não cancela o tick que já
     * atravessou a fila. Fechar Prisma enquanto ele finaliza um job deixava a
     * promise e o pool disputarem o teardown. Aguardar os trabalhos ativos
     * mantém a ordem: parar claims -> terminar trabalho -> fechar o banco.
     */
    await Promise.all([
      this.activeTick,
      this.pumping,
      this.sampling,
      ...[...this.inflight.values()].flatMap((jobs) => [...jobs]),
    ]);
    this.eventLoop.disable();
  }

  /**
   * Um ciclo: preenche as vagas livres de cada grupo e espera os jobs que
   * começou. Exposto para o teste controlar o tempo em vez de esperar.
   *
   * Reentrância é evitada por bandeira: um ciclo lento não dispara outro.
   */
  async tick(): Promise<number> {
    if (this.stopping || this.activeTick) return 0;
    const active = (async () => {
      const started = await this.fill();
      await Promise.all(started);
      return started.length;
    })();
    this.activeTick = active;
    try {
      return await active;
    } finally {
      if (this.activeTick === active) this.activeTick = null;
    }
  }

  /**
   * O laço de produção: preenche vagas e **não** espera os jobs.
   *
   * Um PDF de dois minutos não segura o grupo de notificações: cada grupo tem
   * as próprias vagas, e quando um job termina a vaga é preenchida de novo na
   * hora (`execute` chama `pump` ao final), sem esperar o próximo intervalo.
   */
  private pump(): Promise<void> {
    if (this.stopping || this.pumping) return this.pumping ?? Promise.resolve();
    const running = this.fill()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.pumping = null;
      });
    this.pumping = running;
    return running;
  }

  /** Os grupos que este processo consome, com o processador de cada fila. */
  private groupsFor(role: ReturnType<typeof processRole>): Array<{
    group: QueueGroupConfig;
    processors: Map<JobQueue, JobProcessor>;
  }> {
    const byGroup = new Map<QueueGroupName, Map<JobQueue, JobProcessor>>();
    for (const processor of this.registry.all()) {
      const group = groupOf(processor.queue);
      if (role !== 'combined' && group.role !== role) continue;
      const processors =
        byGroup.get(group.name) ?? new Map<JobQueue, JobProcessor>();
      processors.set(processor.queue, processor);
      byGroup.set(group.name, processors);
    }
    return [...byGroup].map(([name, processors]) => ({
      group: QUEUE_GROUPS[name],
      processors,
    }));
  }

  private async fill(): Promise<Promise<void>[]> {
    const role = processRole();
    if (role === 'api') return [];
    const groups = this.groupsFor(role);
    if (
      !this.stopping &&
      this.timer &&
      !this.sampling &&
      performance.now() - this.lastSample >= 60_000
    ) {
      this.lastSample = performance.now();
      const processors = groups.flatMap(({ processors }) => [
        ...processors.values(),
      ]);
      this.sampling = this.sample(processors, role).finally(() => {
        this.sampling = null;
      });
    }
    const started = await Promise.all(
      groups.map(({ group, processors }) => this.fillGroup(group, processors)),
    );
    return started.flat();
  }

  /** Reivindica até ocupar as vagas do grupo, ou até a fila esvaziar. */
  private async fillGroup(
    group: QueueGroupConfig,
    processors: Map<JobQueue, JobProcessor>,
  ): Promise<Promise<void>[]> {
    const running = this.inflight.get(group.name) ?? new Set<Promise<void>>();
    this.inflight.set(group.name, running);
    const queues = [...processors.keys()];
    const started: Promise<void>[] = [];
    try {
      await this.sweepStalled(queues);
      while (!this.stopping && running.size < group.concurrency) {
        const job = await this.queue.claim(group, queues, generateUuidV7());
        if (!job) break;
        const processor = processors.get(job.queue as JobQueue);
        if (!processor) break;
        const work: Promise<void> = this.execute(group, processor, job).finally(
          () => {
            running.delete(work);
            if (this.timer && !this.stopping) void this.pump();
          },
        );
        running.add(work);
        started.push(work);
      }
    } catch (error) {
      const classified = classifyInternalError(error);
      this.logger.error(
        JSON.stringify({
          stage: 'job-worker-cycle-failed',
          group: group.name,
          errorCategory: classified.category,
          exceptionClass: classified.exceptionClass,
          errorCode: classified.code,
        }),
      );
    }
    return started;
  }

  /** Devolve jobs abandonados, no máximo a cada 30 s por fila. */
  private async sweepStalled(queues: readonly JobQueue[]): Promise<void> {
    const now = performance.now();
    for (const queue of queues) {
      if (this.stopping) return;
      const last = this.lastSweep.get(queue);
      if (last !== undefined && now - last < 30_000) continue;
      await this.queue.requeueStalled(queue, STALLED_AFTER_MS);
      this.lastSweep.set(queue, now);
    }
  }

  /** Um job, com lease renovado enquanto roda. Nunca rejeita. */
  private async execute(
    group: QueueGroupConfig,
    processor: JobProcessor,
    job: BackgroundJobRecord,
  ): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.queue.heartbeat(job).catch(() =>
        this.logger.warn(
          JSON.stringify({
            event: 'job_lease_heartbeat_failed',
            queue: job.queue,
          }),
        ),
      );
    }, 30_000);
    heartbeat.unref();
    try {
      await this.run(group, processor, job);
    } catch (error) {
      const classified = classifyInternalError(error);
      this.logger.error(
        JSON.stringify({
          stage: 'job-worker-cycle-failed',
          queue: job.queue,
          errorCategory: classified.category,
          exceptionClass: classified.exceptionClass,
          errorCode: classified.code,
        }),
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * O processador com o tempo limite do grupo.
   *
   * Estourou: o sinal é abortado — no grupo `pdf` isso encerra a thread de
   * renderização (`renderPdfInThread`) — e o job falha com `JOB_TIMEOUT`,
   * voltando à fila pelo backoff. O processador que ignorar o sinal pode
   * terminar depois, mas o lease já foi devolvido e o `succeed` tardio é
   * recusado.
   */
  private async withTimeout(
    group: QueueGroupConfig,
    work: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new JobTimeoutError(group.timeoutMs);
        controller.abort(error);
        reject(error);
      }, group.timeoutMs);
    });
    const running = work(controller.signal);
    running.catch(() => undefined);
    try {
      await Promise.race([running, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async sample(
    processors: JobProcessor[],
    role: string,
  ): Promise<void> {
    try {
      const queues = await this.queue.snapshot(
        processors.map(({ queue }) => queue),
      );
      if (role !== 'combined') writeFileSync('/tmp/orbit-worker-ready', '');
      this.logger.log(
        JSON.stringify({
          event: 'worker_queue_snapshot',
          role,
          queues: queues.map((queue) => ({
            ...queue,
            group: groupOf(queue.queue).name,
          })),
          rssBytes: process.memoryUsage.rss(),
          eventLoopP95Ms: this.eventLoop.percentile(95) / 1e6,
        }),
      );
      this.eventLoop.reset();
    } catch {
      this.logger.warn(
        JSON.stringify({ event: 'worker_snapshot_failed', role }),
      );
    }
  }

  private async run(
    group: QueueGroupConfig,
    processor: JobProcessor,
    job: BackgroundJobRecord,
  ): Promise<void> {
    const started = Date.now();
    const units = this.scopeOf(job);

    /**
     * Contexto inválido não vira retrato vazio.
     *
     * Só um job legado — enfileirado antes da PR-26.6, quando escopo
     * organizacional não carregava lista — pode chegar aqui sem unidade
     * nenhuma. Enterrar é o comportamento correto: repetir não inventaria o
     * escopo perdido, e executar produziria zeros que ninguém saberia
     * distinguir de zeros verdadeiros.
     */
    if (units.length === 0) {
      this.logger.error(
        JSON.stringify({
          ...this.trace(job),
          failureCode: 'JOB_SCOPE_INVALID',
        }),
      );
      await this.queue.fail(job, 'JOB_SCOPE_INVALID', true);
      return;
    }

    await this.withTenantContext(job, units, async () => {
      try {
        if (!CONTINUING_QUEUES.has(job.queue)) {
          const state = await this.operational.snapshot();
          const eligible =
            state.operational &&
            this.plans.grantsAccess(
              await this.plans.getEntitlements(job.organizationId),
            );
          if (!eligible) {
            await this.queue.defer(
              job,
              state.operational
                ? 'SUBSCRIPTION_NOT_ACTIVE'
                : state.status === 'SUSPENDED'
                  ? 'ORGANIZATION_SUSPENDED'
                  : 'ORGANIZATION_UNAVAILABLE',
            );
            return;
          }
        }
        await this.withTimeout(group, (signal) =>
          group.isolation === 'thread'
            ? withPdfBudget(
                {
                  timeoutMs: group.timeoutMs,
                  signal,
                  concurrency: group.concurrency,
                },
                () => processor.process(job, signal),
              )
            : processor.process(job, signal),
        );
        if (!(await this.queue.succeed(job))) return;
        this.logger.log(
          JSON.stringify({
            ...this.trace(job),
            outcome: 'SUCCEEDED',
            durationMs: Date.now() - started,
          }),
        );
      } catch (error) {
        const permanent = error instanceof PermanentJobError;
        const classified = classifyInternalError(error);
        const failureCode = permanent
          ? 'PERMANENT_JOB_ERROR'
          : error instanceof JobTimeoutError
            ? 'JOB_TIMEOUT'
            : [classified.category, classified.code].filter(Boolean).join(':');
        const record = JSON.stringify({
          ...this.trace(job),
          outcome: 'FAILED',
          permanent,
          durationMs: Date.now() - started,
          errorCategory: classified.category,
          exceptionClass: classified.exceptionClass,
          errorCode: classified.code,
        });
        this.logger.error(record);
        if (!permanent)
          captureOrbitError(
            error,
            {
              requestId: job.correlationId,
              organizationId: job.organizationId,
            },
            job.queue,
          );
        await this.queue.fail(job, failureCode, permanent);
      }
    });
  }

  /**
   * As unidades que este job pode enxergar.
   *
   * `BUSINESS_UNIT` responde a própria unidade; `ORGANIZATION` responde o que
   * o solicitante enxergava quando pediu. Nenhuma consulta ao banco: resolver
   * aqui exigiria ler `business_units`, cuja política já pede a lista de
   * unidades — o impasse que a resolução no enfileiramento evita.
   */
  private scopeOf(job: BackgroundJobRecord): readonly string[] {
    return job.scope === 'BUSINESS_UNIT' && job.businessUnitId
      ? [job.businessUnitId]
      : job.businessUnitIds;
  }

  /**
   * Rastro estruturado, sem payload e sem segredo.
   *
   * O que se precisa para explicar um job: onde ele estava, de quem era e que
   * escopo ele declarou. O conteúdo do trabalho fica no domínio.
   */
  private trace(job: BackgroundJobRecord): Record<string, unknown> {
    return {
      queue: job.queue,
      jobId: job.id,
      organizationId: job.organizationId,
      scope: job.scope,
      businessUnitIds: this.scopeOf(job),
      correlationId: job.correlationId,
      attempt: job.attempts,
    };
  }

  /** Reabre o contexto do tenant que enfileirou, com o escopo declarado. */
  private withTenantContext<T>(
    job: BackgroundJobRecord,
    units: readonly string[],
    work: () => Promise<T>,
  ): Promise<T> {
    /** `UUID` é um tipo marcado; os valores vêm do banco já validados. */
    const asUuid = (value: string | null): UUID | null =>
      value === null ? null : (value as UUID);

    const context = new RequestContext({
      requestId: job.correlationId,
      actorType: 'SYSTEM',
      userId: asUuid(job.actorUserId),
      organizationId: asUuid(job.organizationId),
      businessUnitId: asUuid(job.businessUnitId),
      businessUnitIds: units as readonly UUID[],
      /**
       * O worker não herda papéis nem permissões do ator.
       *
       * Autorização já aconteceu quando o trabalho foi pedido; repeti-la aqui
       * com um papel congelado no tempo seria pior — um papel revogado
       * continuaria valendo. O que o worker precisa é do escopo de dados, e é
       * só isso que ele declara.
       */
      roles: [],
      permissions: [],
      ip: null,
      userAgent: 'orbit-job-worker',
      locale: 'pt-BR',
    });

    return Promise.resolve(this.storage.run(context, work));
  }

  /** Identificador de correlação para quem enfileira. */
  static correlationId(): string {
    return generateUuidV7();
  }
}
