/**
 * Composição do Rendering Engine.
 *
 * Os renderers entram por `ARTIFACT_RENDERER` como um array de providers — é o
 * único lugar que os conhece. Acrescentar um motor (`pdf.chromium`, `docx`) é
 * escrever a classe e somá-la aqui; registry, pipeline, manifest e API não
 * mudam.
 *
 * O worker é registrado neste módulo. Ele não conhece os processadores: cada
 * um se inscreve em `JobProcessorRegistry` ao subir, e o worker percorre o que
 * estiver inscrito — inclusive filas de módulos que este aqui não importa.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { RequestContextModule } from '../../context';
import { ArtifactManifestModule } from '../artifact-manifests/artifact-manifest.module';
import { ArtifactManifestPolicy } from '../artifact-manifests/artifact-manifest.policy';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { BackgroundJobWorker } from '../jobs/background-job.worker';
import { ArtifactRenderAssembler } from './artifact-render.assembler';
import { ArtifactRenderController } from './artifact-render.controller';
import { ArtifactRenderMetrics } from './artifact-render.metrics';
import { ArtifactRenderProcessor } from './artifact-render.processor';
import { ArtifactRenderRepository } from './artifact-render.repository';
import { ArtifactRenderService } from './artifact-render.service';
import { ARTIFACT_RENDERER } from './renderers/artifact-renderer';
import { ArtifactRendererRegistry } from './renderers/renderer.registry';
import { ArtifactHtmlRenderer } from './renderers/html/artifact-html.renderer';
import { ArtifactPdfRenderer } from './renderers/pdf/artifact-pdf.renderer';
import { ArtifactPremiumPdfRenderer } from './renderers/pdf/artifact-premium-pdf.renderer';
import { DocumentContextBuilder } from './document-context.builder';
import { RenderInputFactory } from './render-input.factory';
import { PmocPlanDocumentService } from './pmoc-plan-document.service';
import { QuoteDocumentService } from './quote-document.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    PrismaModule,
    RequestContextModule,
    SubscriptionPlansModule,
    ArtifactManifestModule,
    NotificationsModule,
  ],
  controllers: [ArtifactRenderController],
  providers: [
    ArtifactHtmlRenderer,
    ArtifactPdfRenderer,
    ArtifactPremiumPdfRenderer,
    {
      provide: ARTIFACT_RENDERER,
      inject: [
        ArtifactHtmlRenderer,
        ArtifactPdfRenderer,
        ArtifactPremiumPdfRenderer,
      ],
      useFactory: (
        html: ArtifactHtmlRenderer,
        pdf: ArtifactPdfRenderer,
        premium: ArtifactPremiumPdfRenderer,
      ) => [html, pdf, premium],
    },
    ArtifactRendererRegistry,
    ArtifactRenderAssembler,
    DocumentContextBuilder,
    RenderInputFactory,
    PmocPlanDocumentService,
    QuoteDocumentService,
    ArtifactRenderRepository,
    ArtifactRenderMetrics,
    ArtifactRenderService,
    ArtifactRenderProcessor,
    ArtifactManifestPolicy,
    BackgroundJobWorker,
  ],
  exports: [
    ArtifactRenderService,
    /* O Management Reports monta o timbre do relatório com o mesmo construtor
       dos documentos de campo — um segundo teria de repetir endereço, documento
       e telefone, e divergiria no primeiro campo novo. */
    DocumentContextBuilder,
    PmocPlanDocumentService,
    QuoteDocumentService,
    ArtifactRendererRegistry,
    BackgroundJobWorker,
  ],
})
export class ArtifactRenderingModule {}
