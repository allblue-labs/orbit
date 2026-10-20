/**
 * Composição da comissão de técnicos.
 *
 * ## Módulo próprio, e não dentro do Financeiro
 *
 * A comissão lê atendimento, técnico e receita — três domínios. Colocá-la dentro
 * do Financeiro faria aquele módulo conhecer operação e workforce para calcular
 * um valor que não é lançamento dele. A permissão continua sendo a financeira,
 * porque é dinheiro a pagar; a composição é separada porque as dependências são
 * outras.
 *
 * ## Nenhum serviço de outro módulo é injetado
 *
 * O repositório lê as tabelas de que precisa dentro da própria RLS. Injetar
 * `OperationService` traria paginação, mapeamento e regras de atendimento para
 * dentro de um cálculo que só precisa de quatro colunas.
 */
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { SubscriptionPlansModule } from '../subscription-plans/subscription-plans.module';
import { CommissionController } from './commission.controller';
import { CommissionRepository } from './commission.repository';
import { CommissionService } from './commission.service';

@Module({
  imports: [PrismaModule, SubscriptionPlansModule],
  controllers: [CommissionController],
  providers: [CommissionRepository, CommissionService],
  exports: [CommissionService],
})
export class CommissionsModule {}
