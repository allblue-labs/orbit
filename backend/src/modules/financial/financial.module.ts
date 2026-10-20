/**
 * Composição do Financeiro.
 *
 * O processador de recibos mora aqui, e não no Document Center: quem reage ao
 * evento conhece quem o publica, nunca o contrário. `JobsModule` é global, e é
 * onde o processador se inscreve.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { FinancialController } from './financial.controller';
import { FinancialMapper } from './financial.mapper';
import { FinancialRepository } from './financial.repository';
import { FinancialService } from './financial.service';
import { ArtifactExecutionModule } from '../artifact-executions/artifact-execution.module';
import { ReceiptEntryProcessor } from './receipt-entry.processor';
import { ReceiptService } from './receipt.service';

@Module({
  /* `ArtifactExecutionModule` porque o recibo **é** uma execução de artefato: a
     emissão reaproveita a criação, a validação de campo contra o snapshot
     congelado e a gravação de resposta, em vez de uma segunda implementação. */
  imports: [PrismaModule, SubscriptionPlansModule, ArtifactExecutionModule],
  controllers: [FinancialController],
  providers: [
    FinancialRepository,
    FinancialService,
    FinancialMapper,
    ReceiptEntryProcessor,
    ReceiptService,
  ],
  exports: [FinancialService],
})
export class FinancialModule {}
