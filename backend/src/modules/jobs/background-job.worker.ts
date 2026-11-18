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
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import type { UUID } from '../../contracts';
import { RequestContext, RequestContextStorage } from '../../context';
import { classifyInternalError, internalErrorStack } from '../../errors';
import { generateUuidV7 } from '../../utils';
import { BackgroundJobQueue } from './background-job.queue';
import {
  JOB_QUEUES,
  PermanentJobError,
  type BackgroundJobRecord,
  type JobProcessor,
} from './background-job.types';
import { JobProcessorRegistry } from './job-processor.registry';

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
      () => void this.processTick(),
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
      this.sampling,
      ...this.activeLanes.values(),
    ]);
    this.eventLoop.disable();
  }

  /**
   * Um ciclo.
   *
   * Reentrância é evitada por bandeira: um ciclo lento não deve disparar outro
   * em cima. Exposto para o teste controlar o tempo em vez de esperar.
   */
  async tick(): Promise<number> {
    if (this.stopping || this.activeTick) return 0;
    const active = this.processTick();
    this.activeTick = active;
    try {
      return await active;
    } finally {
      if (this.activeTick === active) this.activeTick = null;
    }
  }

  private async processTick(): Promise<number> {
    const role = processRole();
    const documents: ReadonlySet<string> = new Set([
      JOB_QUEUES.artifactRender,
      JOB_QUEUES.managementReport,
    ]);
    const processors = this.registry
      .all()
      .filter(
        ({ queue }) =>
          role === 'combined' ||
          (role === 'documents' ? documents.has(queue) : !documents.has(queue)),
      );
    if (role === 'api') return 0;
    const lanes: JobProcessor[][] = [[], [], []];
    for (const processor of processors) {
      const lane =
        role === 'combined' || documents.has(processor.queue)
          ? 0
          : processor.queue === JOB_QUEUES.mobilePushDelivery ||
              processor.queue === JOB_QUEUES.mobileNotification
            ? 1
            : 2;
      lanes[lane]!.push(processor);
    }
    // Each lane is single-flight. Independent timers can keep draining the
    // notification lane while another lane waits on a slow external service.
    if (
      !this.stopping &&
      this.timer &&
      !this.sampling &&
      performance.now() - this.lastSample >= 60_000
    ) {
      this.lastSample = performance.now();
      this.sampling = this.sample(processors, role).finally(() => {
        this.sampling = null;
      });
    }
    const counts = await Promise.all(
      lanes.map((lane, index) => this.runLane(lane, index)),
    );
    return counts.reduce((sum, count) => sum + count, 0);
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
          queues,
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

  private readonly activeLanes = new Map<number, Promise<number>>();

  private async runLane(
    processors: JobProcessor[],
    lane: number,
  ): Promise<number> {
    if (this.stopping || this.activeLanes.has(lane) || !processors.length)
      return 0;
    const running = this.drainLane(processors);
    this.activeLanes.set(lane, running);
    try {
      return await running;
    } finally {
      this.activeLanes.delete(lane);
    }
  }

  private async drainLane(processors: JobProcessor[]): Promise<number> {
    let processed = 0;
    for (const processor of processors) {
      if (this.stopping) break;
      try {
        const now = performance.now();
        if (
          !this.lastSweep.has(processor.queue) ||
          now - this.lastSweep.get(processor.queue)! >= 30_000
        ) {
          await this.queue.requeueStalled(processor.queue, STALLED_AFTER_MS);
          this.lastSweep.set(processor.queue, now);
        }
        if (this.stopping) break;
        const job = await this.queue.claim(processor.queue, generateUuidV7());
        if (!job) continue;
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
          await this.run(processor, job);
          processed++;
        } finally {
          clearInterval(heartbeat);
        }
      } catch (error) {
        const classified = classifyInternalError(error);
        this.logger.error(
          JSON.stringify({
            stage: 'job-worker-cycle-failed',
            queue: processor.queue,
            errorCategory: classified.category,
            exceptionClass: classified.exceptionClass,
            errorCode: classified.code,
          }),
        );
      }
    }
    return processed;
  }

  private async run(
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
        await processor.process(job);
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
        if (process.env.NODE_ENV === 'production') {
          this.logger.error(record);
        } else {
          this.logger.error(record, internalErrorStack(error));
        }
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
