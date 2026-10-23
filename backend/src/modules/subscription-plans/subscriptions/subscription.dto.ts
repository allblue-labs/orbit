import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Min } from 'class-validator';
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

export class CancelSubscriptionDto extends SubscriptionVersionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acknowledgeDataDeletion?: boolean;
}

export class ChangeSubscriptionPlanDto extends SubscriptionVersionDto {
  @ApiPropertyOptional({
    description: 'Confirma a perda dos dias de teste ao pagar o novo plano',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeTrialEnd?: boolean;

  @ApiProperty({ enum: Object.values(PlanCode) })
  @IsIn(Object.values(PlanCode))
  planCode!: PlanCodeType;

  @ApiPropertyOptional({ enum: Object.values(BillingInterval) })
  @IsOptional()
  @IsIn(Object.values(BillingInterval))
  billingInterval?: BillingIntervalType;
}
