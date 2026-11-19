import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Min,
} from 'class-validator';
import {
  BillingInterval,
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
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  expectedCatalogVersion?: number;

  @ApiPropertyOptional({
    description: 'Confirma a perda dos dias de teste ao pagar o novo plano',
  })
  @IsOptional()
  @IsBoolean()
  acknowledgeTrialEnd?: boolean;

  @ApiProperty({ example: 'PROFESSIONAL' })
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  planCode!: PlanCodeType;

  @ApiPropertyOptional({ enum: Object.values(BillingInterval) })
  @IsOptional()
  @IsIn(Object.values(BillingInterval))
  billingInterval?: BillingIntervalType;
}
