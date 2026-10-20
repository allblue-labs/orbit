import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { IssuedDocumentController } from './issued-document.controller';
import { IssuedDocumentRepository } from './issued-document.repository';
import { IssuedDocumentService } from './issued-document.service';

/**
 * Leitura, e só leitura.
 *
 * Nada aqui emite nem altera documento: quem emite é o módulo de artefatos e o de
 * relatórios, cada um com as suas regras. Este responde "o que já saiu".
 */
@Module({
  imports: [PrismaModule, SubscriptionPlansModule],
  controllers: [IssuedDocumentController],
  providers: [IssuedDocumentRepository, IssuedDocumentService],
  exports: [IssuedDocumentService],
})
export class IssuedDocumentModule {}
