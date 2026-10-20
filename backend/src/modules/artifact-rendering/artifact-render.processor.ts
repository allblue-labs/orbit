/**
 * O pipeline, do outro lado da fila.
 *
 * ```
 * job ──▶ lê execução ──▶ monta entrada ──▶ renderer ──▶ bytes
 *                                                          │
 *                     manifest (PR-19): storage, hash, revisão
 *                                                          │
 *                                                  renderStatus = READY
 * ```
 *
 * ## O que este processador não faz
 *
 * Não guarda arquivo, não calcula hash, não numera revisão, não aposenta a
 * anterior. Tudo isso é `ArtifactManifestService.issueWithContent`, da PR-19 —
 * o renderer produz conteúdo e o manifest cuida do resto. Duplicar qualquer uma
 * dessas responsabilidades aqui criaria uma segunda verdade sobre o que é um
 * documento emitido.
 *
 * ## Idempotência
 *
 * Um job pode rodar duas vezes: processo derrubado no meio, job devolvido por
 * tempo limite, retry após falha. As duas defesas:
 *
 * 1. **a revisão é aberta pelo próprio processador**, não pelo pedido — uma
 *    reexecução abre a revisão seguinte em vez de reemitir na mesma;
 * 2. **a revisão já emitida é recusada** pela política do manifest, então nunca
 *    há duas emissões no mesmo registro.
 *
 * O efeito colateral honesto de uma reexecução é uma revisão a mais, com o
 * mesmo conteúdo — visível no histórico, que é onde deve estar.
 */
import {
  Injectable,
  Logger,
  Optional,
  type OnModuleInit,
} from '@nestjs/common';
import { ArtifactManifestService } from '../artifact-manifests/artifact-manifest.service';
import { JobProcessorRegistry } from '../jobs/job-processor.registry';
import {
  PermanentJobError,
  JOB_QUEUES,
  type BackgroundJobRecord,
  type JobProcessor,
  type JobQueue,
} from '../jobs/background-job.types';
import { RenderInputFactory } from './render-input.factory';
import { ArtifactRenderMetrics } from './artifact-render.metrics';
import { ArtifactRenderRepository } from './artifact-render.repository';
import { ArtifactRendererRegistry } from './renderers/renderer.registry';
import type { RenderJobPayload } from './artifact-render.service';
import { MobileNotificationService } from '../notifications/mobile-notification.service';

/** Nome do arquivo emitido — o código da execução é o que identifica. */
const fileNameFor = (code: string, format: string): string =>
  `${code.replace(/[^A-Za-z0-9._-]/g, '_')}.${format.toLowerCase()}`;

@Injectable()
export class ArtifactRenderProcessor implements JobProcessor, OnModuleInit {
  readonly queue: JobQueue = JOB_QUEUES.artifactRender;
  private readonly logger = new Logger(ArtifactRenderProcessor.name);

  constructor(
    private readonly repository: ArtifactRenderRepository,
    private readonly inputs: RenderInputFactory,
    private readonly renderers: ArtifactRendererRegistry,
    private readonly manifests: ArtifactManifestService,
    private readonly metrics: ArtifactRenderMetrics,
    private readonly registry: JobProcessorRegistry,
    @Optional()
    private readonly mobileNotifications?: MobileNotificationService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: BackgroundJobRecord): Promise<void> {
    const payload = this.payload(job);
    const started = Date.now();

    /** Renderer removido entre o pedido e o trabalho: não adianta repetir. */
    if (!this.renderers.has(payload.renderer)) {
      await this.fail(
        job,
        payload,
        started,
        'O renderizador solicitado não está disponível',
        true,
      );
      throw new PermanentJobError('Renderer is no longer registered');
    }

    const source = await this.repository.findRenderSource(
      payload.executionId,
      job.organizationId,
    );
    if (!source) {
      /** Execução removida: o job não tem mais objeto. */
      throw new PermanentJobError('Artifact execution no longer exists');
    }

    /**
     * Crash/retry depois da emissão, mas antes de marcar READY: o manifest já
     * é a autoridade. Reconciliar o estado evita uma segunda revisão/PDF.
     */
    if (source.fieldArtifact && source.manifests.length > 0) {
      await this.repository.markReady(payload.executionId);
      if (source.fieldArtifact && this.mobileNotifications) {
        try {
          await this.mobileNotifications.materialize({
            organizationId: job.organizationId,
            businessUnitId: source.businessUnitId,
            recipientUserId: source.responsibleUserId ?? source.createdById,
            type: 'ARTIFACT_AVAILABLE',
            factId: source.manifests[0]!.id,
            resourceId: source.fieldArtifact.id,
            correlationId: job.correlationId,
          });
        } catch (error) {
          this.logger.warn(
            JSON.stringify({
              event: 'mobile_notification_materialization_failed',
              type: 'ARTIFACT_AVAILABLE',
              errorClass:
                error instanceof Error ? error.constructor.name : 'Unknown',
            }),
          );
        }
      }
      return;
    }

    if (job.attempts > 1) {
      this.metrics.recordRetry(
        payload.renderer,
        job.correlationId,
        job.attempts,
      );
    }

    await this.repository.markRendering(payload.executionId);

    try {
      const renderer = this.renderers.get(payload.renderer);

      /**
       * A montagem é do fabricante, e não daqui.
       *
       * O preview parte exatamente do mesmo input e do mesmo renderer — a
       * diferença entre os dois caminhos é só o que acontece com os bytes.
       * Montar aqui de novo faria o que o owner vê divergir do que ele recebe
       * na primeira mudança, e em silêncio.
       */
      const input = await this.inputs.build(source, job.correlationId);

      const output = await renderer.render(input);

      /**
       * A partir daqui é PR-19.
       *
       * Abrir revisão, guardar o arquivo, calcular o hash sobre o que foi
       * gravado, emitir e aposentar a anterior — nada disso acontece aqui.
       */
      const actor = {
        organizationId: job.organizationId,
        actorId: job.actorUserId ?? source.createdById,
      };

      const manifest = await this.manifests.openRevision(
        payload.executionId,
        actor,
        {
          renderer: renderer.id,
          rendererVersion: renderer.version,
          format: output.format,
          metadata: {
            ...payload.metadata,
            ...output.metadata,
            correlationId: job.correlationId,
          },
        },
      );

      const issued = await this.manifests.issueWithContent(manifest.id, actor, {
        bytes: output.bytes,
        fileName: fileNameFor(source.code, output.format),
        mimeType: output.mimeType,
        rendererVersion: output.rendererVersion,
        metadata: { correlationId: job.correlationId },
      });

      await this.repository.markReady(payload.executionId);
      if (source.fieldArtifact && this.mobileNotifications) {
        try {
          await this.mobileNotifications.materialize({
            organizationId: job.organizationId,
            businessUnitId: source.businessUnitId,
            recipientUserId: source.responsibleUserId ?? source.createdById,
            type: 'ARTIFACT_AVAILABLE',
            factId: issued.id,
            resourceId: source.fieldArtifact.id,
            correlationId: job.correlationId,
          });
        } catch (error) {
          this.logger.warn(
            JSON.stringify({
              event: 'mobile_notification_materialization_failed',
              type: 'ARTIFACT_AVAILABLE',
              errorClass:
                error instanceof Error ? error.constructor.name : 'Unknown',
            }),
          );
        }
      }
      await this.repository.audit(
        job.organizationId,
        source.businessUnitId,
        actor.actorId,
        'ARTIFACT_RENDER_COMPLETED',
        payload.executionId,
        {
          renderer: renderer.id,
          rendererVersion: renderer.version,
          manifestId: issued.id,
          revision: issued.revision,
          contentHash: issued.contentHash,
          correlationId: job.correlationId,
        },
      );

      this.metrics.recordSuccess({
        renderer: renderer.id,
        correlationId: job.correlationId,
        executionId: payload.executionId,
        manifestId: issued.id,
        revision: issued.revision,
        durationMs: Date.now() - started,
        bytes: output.bytes.length,
        attempt: job.attempts,
      });
    } catch (error) {
      const permanent = error instanceof PermanentJobError;
      /**
       * A mensagem gravada é de negócio.
       *
       * Detalhe técnico — stack, caminho, credencial — fica no log do worker,
       * com o mesmo `correlationId`. O tenant vê o que aconteceu, não como o
       * servidor é feito por dentro.
       */
      await this.fail(
        job,
        payload,
        started,
        this.publicReason(error),
        permanent,
      );
      throw error;
    }
  }

  private async fail(
    job: BackgroundJobRecord,
    payload: RenderJobPayload,
    started: number,
    reason: string,
    permanent: boolean,
  ): Promise<void> {
    /**
     * `FAILED` só na última tentativa.
     *
     * Enquanto há retry pela frente, o estado continua `RENDERING`: dizer ao
     * usuário que falhou e depois voltar a READY seria mentir duas vezes.
     */
    const willRetry = !permanent && job.attempts < job.maxAttempts;
    if (!willRetry) {
      await this.repository.markFailed(payload.executionId, reason);
    }

    this.metrics.recordFailure({
      renderer: payload.renderer,
      correlationId: job.correlationId,
      executionId: payload.executionId,
      durationMs: Date.now() - started,
      attempt: job.attempts,
      permanent,
      reason,
    });
  }

  private payload(job: BackgroundJobRecord): RenderJobPayload {
    const executionId = job.payload.executionId;
    const renderer = job.payload.renderer;

    if (typeof executionId !== 'string' || typeof renderer !== 'string') {
      throw new PermanentJobError('Render job payload is malformed');
    }

    return {
      executionId,
      renderer,
      metadata:
        job.payload.metadata &&
        typeof job.payload.metadata === 'object' &&
        !Array.isArray(job.payload.metadata)
          ? (job.payload.metadata as Record<string, unknown>)
          : {},
    };
  }

  /** Mensagem que pode ser mostrada ao tenant. */
  private publicReason(error: unknown): string {
    if (error instanceof PermanentJobError) return error.message;
    if (error instanceof Error) {
      /** Erros de domínio já são escritos para leitura humana. */
      const name = error.constructor.name;
      if (name.endsWith('Exception')) return error.message;
    }
    return 'A renderização falhou. A equipe técnica tem o detalhe no registro.';
  }
}
