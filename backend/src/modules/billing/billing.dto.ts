import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  Matches,
  IsInt,
  IsOptional,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  BillingInterval,
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
  @ApiProperty({ example: 'PROFESSIONAL' })
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  planCode!: PlanCodeType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedCatalogVersion?: number;

  @ApiProperty({ enum: Object.values(BillingInterval) })
  @IsIn(Object.values(BillingInterval))
  billingInterval!: BillingIntervalType;

  @ApiPropertyOptional({ example: 'ORBIT-INICIO' })
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/)
  promotionCode?: string;
}
