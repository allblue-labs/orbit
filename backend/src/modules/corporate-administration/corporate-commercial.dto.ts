import { IsIn, IsInt, IsUUID, Matches, Min, ValidateIf } from 'class-validator';
import { BillingInterval } from '../subscription-plans/catalog/plan-catalog.types';

export class CorporatePlanQueryDto {
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsUUID()
  organizationId?: string;
}

export class CorporateSubscriptionCommandDto {
  @IsUUID()
  expectedSubscriptionId!: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsIn(['ADMINISTRATIVE', 'CUSTOMER_REQUEST', 'CONTRACT_REVIEW', 'CORRECTION'])
  reason!: string;
}

export class CorporatePlanCommandDto extends CorporateSubscriptionCommandDto {
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  planCode!: string;

  @IsInt()
  @Min(1)
  expectedCatalogVersion!: number;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsIn(Object.values(BillingInterval))
  billingInterval?: BillingInterval;
}
