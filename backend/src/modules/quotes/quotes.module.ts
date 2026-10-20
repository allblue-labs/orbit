/**
 * Composição do Commercial Engine.
 *
 * Depende do Financeiro, e não o contrário: aprovar uma proposta cria receita
 * prevista, mas o Financeiro não sabe o que é um orçamento — ele só conhece
 * `source = 'QUOTE'`, um rótulo de procedência.
 *
 * O processador do evento mora aqui pelo mesmo motivo: quem reage conhece quem
 * publica.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { FinancialModule } from '../financial/financial.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { QuoteController } from './quote.controller';
import { QuoteFinancialProcessor } from './quote-financial.processor';
import { QuoteMapper } from './quote.mapper';
import { QuoteEmissionService } from './quote-emission.service';
import { QuoteRepository } from './quote.repository';
import { QuoteService } from './quote.service';
import { StorageModule } from '../storage/storage.module';
import { ArtifactRenderingModule } from '../artifact-rendering/artifact-rendering.module';
import { ArtifactExecutionModule } from '../artifact-executions/artifact-execution.module';

@Module({
  imports: [
    PrismaModule,
    SubscriptionPlansModule,
    FinancialModule,
    ArtifactRenderingModule,
    /* Para ler os bytes da assinatura do responsável na hora de imprimir. */
    StorageModule,
    /* Emitir o documento da proposta é criar uma execução de artefato. */
    ArtifactExecutionModule,
  ],
  controllers: [QuoteController],
  providers: [
    QuoteRepository,
    QuoteService,
    QuoteMapper,
    QuoteFinancialProcessor,
    QuoteEmissionService,
  ],
  exports: [QuoteService],
})
export class QuotesModule {}
