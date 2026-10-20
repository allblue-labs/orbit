import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import {
  BillingInterval,
  PlanCode,
  type BillingInterval as BillingIntervalType,
  type PlanCode as PlanCodeType,
} from '../catalog/plan-catalog.types';

/** Todo comando devolve a versão que leu. Sem ela, não há controle otimista. */
export class SubscriptionVersionDto {
  @ApiProperty()
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class ChangeSubscriptionPlanDto extends SubscriptionVersionDto {
  @ApiProperty({ enum: Object.values(PlanCode) })
  @IsIn(Object.values(PlanCode))
  planCode!: PlanCodeType;

  @ApiPropertyOptional({ enum: Object.values(BillingInterval) })
  @IsOptional()
  @IsIn(Object.values(BillingInterval))
  billingInterval?: BillingIntervalType;
}
