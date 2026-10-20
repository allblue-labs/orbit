/**
 * O outro lado da fila: compõe, desenha e fecha o relatório.
 *
 * ```
 * job ──▶ claim ──▶ providers ──▶ snapshot + hash ──▶ renderer ──▶ storage
 *                                                                    │
 *                                                          READY (imutável)
 * ```
 *
 * ## Idempotência
 *
 * `claim` recusa relatório já `READY`: reentrega da fila, job devolvido por
 * tempo limite e retry convergem para **um** snapshot e **um** arquivo. Um
 * relatório histórico não é recomposto — se fosse, os números de março
 * mudariam sozinhos em maio, que é exatamente o que um snapshot existe para
 * impedir.
 *
 * Um retry que acontece **antes** de o relatório ficar pronto recompõe do
 * zero, e isso é correto: não havia snapshot para preservar. O arquivo
 * anterior, se existisse, seria de uma composição incompleta.
 *
 * ## O worker reabre o contexto do tenant
 *
 * Como no Rendering Engine: organização, unidade e ator vêm do job, e o
 * `BackgroundJobWorker` reabre o `RequestContext` antes de chamar aqui.
 * Nenhuma agregação roda como administrador da plataforma.
 *
 * ## Falha é do relatório, não do worker
 *
 * Erro fecha como `FAILED` com motivo em linguagem de negócio e **relança**:
 * a fila decide entre repetir e enterrar. O detalhe técnico fica no log, com o
 * mesmo `correlationId`.
 */
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ArtifactRendererRegistry } from '../artifact-rendering/renderers/renderer.registry';
import { DocumentContextBuilder } from '../artifact-rendering/document-context.builder';
import { readEmbeddedImage } from '../../common/embedded-image';
import { issuerLogo } from '../../common/issuer-brand';
import {
  JOB_QUEUES,
  PermanentJobError,
  type BackgroundJobRecord,
  type JobProcessor,
  type JobQueue,
} from '../jobs/background-job.types';
import { JobProcessorRegistry } from '../jobs/job-processor.registry';
import {
  FileObjectService,
  STORAGE_NAMESPACES,
} from '../storage/file-object.service';
import { RENDERER_BY_FORMAT, type ReportFormat } from './report.catalog';
import { ReportComposer } from './report.composer';
import { ReportRenderAdapter } from './report.render-adapter';
import { ReportRepository, type ReportScope } from './report.repository';
import type { ReportAccess } from './providers/report.provider';

/** O que o job carrega — o mínimo para recompor o contexto. */
export interface ReportJobPayload {
  reportId: string;
  capabilities: string[];
  permissions: string[];
}

@Injectable()
export class ReportGenerationProcessor implements JobProcessor, OnModuleInit {
  readonly queue: JobQueue = JOB_QUEUES.managementReport;

  private readonly logger = new Logger(ReportGenerationProcessor.name);

  constructor(
    private readonly repository: ReportRepository,
    private readonly composer: ReportComposer,
    private readonly adapter: ReportRenderAdapter,
    private readonly renderers: ArtifactRendererRegistry,
    private readonly files: FileObjectService,
    private readonly registry: JobProcessorRegistry,
    private readonly documentContext: DocumentContextBuilder,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async process(job: BackgroundJobRecord): Promise<void> {
    const payload = this.payload(job);
    const report = await this.repository.find(
      payload.reportId,
      job.organizationId,
    );

    if (!report) {
      /** Relatório removido entre o pedido e o trabalho. Repetir não o traz. */
      throw new PermanentJobError('Management report no longer exists');
    }

    const claimed = await this.repository.claim(report.id);
    if (!claimed) {
      this.logger.log(
        JSON.stringify({
          stage: 'report-already-ready',
          reportId: report.id,
          correlationId: report.correlationId,
        }),
      );
      return;
    }

    const started = Date.now();
    try {
      const scope: ReportScope = {
        organizationId: job.organizationId,
        businessUnitId: report.businessUnit?.id ?? null,
        from: report.periodFrom,
        to: report.periodTo,
        timezone: report.timezone,
        customerId: this.text(report.parameters, 'customerId'),
        operationKind: this.text(report.parameters, 'operationKind'),
        operationStatus: this.text(report.parameters, 'operationStatus'),
      };

      /**
       * A autorização do **momento do pedido** viaja no job.
       *
       * É o que garante que o relatório componha exatamente o que o solicitante
       * podia ver — nem mais, se o papel dele mudar depois; nem menos, se o
       * worker rodar sem sessão. Recarregar as permissões aqui faria o conteúdo
       * depender de quando o worker acordou.
       */
      const access: ReportAccess = {
        capabilities: new Set(payload.capabilities),
        permissions: new Set(payload.permissions),
        wildcardCapability: payload.capabilities.includes('*'),
        wildcardPermission: payload.permissions.includes('*'),
      };

      const composeStarted = Date.now();
      const composed = await this.composer.compose({
        type: report.type,
        scope,
        access,
        parameters: (report.parameters ?? {}) as Record<string, unknown>,
        businessUnitName:
          report.businessUnit?.tradeName ??
          report.businessUnit?.legalName ??
          null,
      });
      const composeMs = Date.now() - composeStarted;

      const renderStarted = Date.now();
      const rendered = await this.render(report, composed.sourceHash, {
        snapshot: composed.snapshot,
        organizationId: job.organizationId,
        businessUnitId: report.businessUnit?.id ?? null,
        actorId: job.actorUserId,
        correlationId: report.correlationId,
      });
      const renderMs = Date.now() - renderStarted;

      await this.repository.markReady(report.id, {
        data: composed.snapshot as unknown as Prisma.InputJsonValue,
        sourceHash: composed.sourceHash,
        provenance: composed.snapshot
          .sources as unknown as Prisma.InputJsonValue,
        fileId: rendered.fileId,
        renderer: rendered.renderer,
      });

      await this.repository.audit(
        job.organizationId,
        job.actorUserId ?? report.generatedBy.id,
        'MANAGEMENT_REPORT_GENERATED',
        report.id,
        {
          type: report.type,
          sourceHash: composed.sourceHash,
          renderer: rendered.renderer,
          bytes: rendered.bytes,
          correlationId: report.correlationId,
        },
      );

      this.logger.log(
        JSON.stringify({
          stage: 'report-generated',
          reportId: report.id,
          type: report.type,
          correlationId: report.correlationId,
          attempt: claimed.attempts,
          composeMs,
          renderMs,
          durationMs: Date.now() - started,
          bytes: rendered.bytes,
          sections: composed.snapshot.sections.length,
          sources: composed.snapshot.sources
            .filter((source) => source.included)
            .map((source) => source.source),
          sourceHash: composed.sourceHash,
        }),
      );
    } catch (error) {
      const reason = this.publicReason(error);
      await this.repository.markFailed(report.id, reason);

      this.logger.warn(
        JSON.stringify({
          stage: 'report-failed',
          reportId: report.id,
          type: report.type,
          correlationId: report.correlationId,
          attempt: claimed.attempts,
          durationMs: Date.now() - started,
          reason,
        }),
      );

      if (this.isPermanentCompositionError(error)) {
        throw new PermanentJobError(reason, error);
      }
      throw error;
    }
  }

  /**
   * Desenha e guarda.
   *
   * O renderizador é o do Artifact Engine — `pdf.premium` produz o mesmo
   * documento que os artefatos de campo, com timbre, faixa da marca e rodapé
   * numerado. O arquivo vai para o Storage com SHA-256 calculado sobre o que foi
   * gravado, no namespace de relatórios.
   */
  private async render(
    report: { id: string; type: string; format: string },
    sourceHash: string,
    context: {
      snapshot: Awaited<ReturnType<ReportComposer['compose']>>['snapshot'];
      organizationId: string;
      businessUnitId: string | null;
      actorId: string | null;
      correlationId: string;
    },
  ): Promise<{
    fileId: string | null;
    renderer: string | null;
    bytes: number;
  }> {
    const rendererId =
      RENDERER_BY_FORMAT[report.format as ReportFormat] ?? 'pdf.default';

    if (!this.renderers.has(rendererId)) {
      throw new PermanentJobError(
        `O renderizador ${rendererId} não está disponível`,
      );
    }

    const renderer = this.renderers.get(rendererId);

    /* O timbre da unidade do recorte. A logo é data URI do próprio inquilino:
       `readEmbeddedImage` recusa URL — que o servidor teria de buscar — e SVG,
       que é documento e não imagem. */
    const unidade = await this.repository.findLetterhead(
      context.organizationId,
      context.businessUnitId,
    );
    const { emitter } = this.documentContext.build({
      businessUnit: unidade ?? undefined,
      logo: readEmbeddedImage(issuerLogo(unidade)) ?? undefined,
    });

    const output = await renderer.render(
      this.adapter.toRenderInput({
        reportId: report.id,
        snapshot: context.snapshot,
        organizationName: context.snapshot.scope.businessUnitName ?? 'Orbit',
        correlationId: context.correlationId,
        sourceHash,
        emitter,
      }),
    );

    const file = await this.files.store({
      organizationId: context.organizationId,
      businessUnitId: context.businessUnitId,
      namespace: STORAGE_NAMESPACES.report,
      fileName: `${report.type.toLowerCase()}-${sourceHash.slice(0, 8)}.${output.format.toLowerCase()}`,
      mimeType: output.mimeType,
      body: output.bytes,
      metadata: {
        reportId: report.id,
        reportType: report.type,
        sourceHash,
        correlationId: context.correlationId,
      },
      createdById: context.actorId,
    });

    return {
      fileId: file.id,
      renderer: `${renderer.id}@${renderer.version}`,
      bytes: output.bytes.length,
    };
  }

  private payload(job: BackgroundJobRecord): ReportJobPayload {
    const reportId = job.payload.reportId;
    if (typeof reportId !== 'string') {
      throw new PermanentJobError('report job without reportId');
    }
    return {
      reportId,
      capabilities: this.list(job.payload.capabilities),
      permissions: this.list(job.payload.permissions),
    };
  }

  private list(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }

  private text(parameters: unknown, key: string): string | null {
    if (!parameters || typeof parameters !== 'object') return null;
    const value = (parameters as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : null;
  }

  /** Motivo de negócio. Stack e caminho ficam no log, com o correlationId. */
  private publicReason(error: unknown): string {
    if (error instanceof PermanentJobError) return error.message;
    return 'Não foi possível compor o relatório. Tente novamente ou contate o suporte.';
  }

  /** Input/configuração inválida não fica bloqueando a fila com retry inútil. */
  private isPermanentCompositionError(error: unknown): boolean {
    if (error instanceof PermanentJobError) return true;
    if (!error || typeof error !== 'object') return false;

    /**
     * Não use `instanceof` aqui. O client gerado e o runtime carregado pelo
     * Jest podem materializar cópias diferentes da classe do Prisma, embora o
     * contrato público do erro (`code`/`meta`) seja o mesmo.
     */
    const candidate = error as {
      code?: unknown;
      meta?: { code?: unknown } | null;
      message?: unknown;
    };
    if (candidate.code !== 'P2010') return false;

    const rawDatabaseCode = candidate.meta?.code;
    const databaseCode =
      typeof rawDatabaseCode === 'string' || typeof rawDatabaseCode === 'number'
        ? String(rawDatabaseCode)
        : '';
    if (databaseCode === '22023') return true;

    // Prisma 7 pode omitir `meta.code` na instância reidratada, mas conserva
    // o código SQLSTATE na mensagem. Exigimos também a assinatura de timezone
    // para que outro P2010/22023 continue seguindo a política normal de retry.
    const message =
      typeof candidate.message === 'string' ? candidate.message : '';
    return (
      message.includes('22023') && /time zone .*not recognized/i.test(message)
    );
  }
}
