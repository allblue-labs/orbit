import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import {
  BillingInterval,
  PlanCode,
  type BillingInterval as BillingIntervalType,
  type PlanCode as PlanCodeType,
} from '../subscription-plans/catalog/plan-catalog.types';

/**
 * O que a contratação aceita — e o que ela deliberadamente não aceita.
 *
 * Dois campos, os dois de conjunto fechado. Não existe `amount`, não existe
 * `priceId`, não existe `trialDays`, não existe `organizationId`: com
 * `forbidNonWhitelisted` ligado, mandar qualquer um deles é **400**, e não um
 * campo silenciosamente ignorado. A diferença importa — ignorar em silêncio
 * ensina que tentar não custa nada.
 *
 * Preço, valor, avaliação e organização são resolvidos no servidor.
 */
export class CreateCheckoutSessionDto {
  @ApiProperty({ enum: Object.values(PlanCode) })
  @IsIn(Object.values(PlanCode))
  planCode!: PlanCodeType;

  @ApiProperty({ enum: Object.values(BillingInterval) })
  @IsIn(Object.values(BillingInterval))
  billingInterval!: BillingIntervalType;
}
