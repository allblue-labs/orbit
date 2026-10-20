/**
 * Composição do domínio PMOC.
 *
 * O módulo é pequeno de propósito: ele **não** traz Operations, Scheduling nem
 * Artifact Engine como dependências de serviço. O que precisa deles é escrita
 * pontual — uma ordem de serviço, um evento de agenda, o vínculo de uma
 * execução —, e isso acontece no repositório, sob a mesma transação e a mesma
 * RLS. Importar os três serviços criaria um nó de dependências entre módulos
 * que hoje não se conhecem.
 *
 * `DomainEventEmitter` vem do `AutomationsModule`, que é global.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { WorkforceModule } from '../workforce/workforce.module';
import { ArtifactRenderingModule } from '../artifact-rendering/artifact-rendering.module';
import { PmocDueProcessor } from './pmoc-due.processor';
import { PmocPublicContractController } from './pmoc-public-contract.controller';
import { PmocController } from './pmoc.controller';
import { PmocMapper } from './pmoc.mapper';
import { PmocRepository } from './pmoc.repository';
import { PmocService } from './pmoc.service';

@Module({
  imports: [
    PrismaModule,
    SubscriptionPlansModule,
    WorkforceModule,
    ArtifactRenderingModule,
  ],
  controllers: [PmocController, PmocPublicContractController],
  providers: [PmocRepository, PmocMapper, PmocService, PmocDueProcessor],
  exports: [PmocService, PmocRepository],
})
export class PmocModule {}
