import { billingModes } from './corporate-completion.dto';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BillingInterval } from '../subscription-plans/catalog/plan-catalog.types';

export const promotionStatuses = [
  'DRAFT',
  'ACTIVATING',
  'ACTIVE',
  'DEACTIVATING',
  'INACTIVE',
] as const;
export const redemptionStatuses = [
  'RESERVED',
  'CONFIRMED',
  'RELEASED',
] as const;
const reasons = [
  'ADMINISTRATIVE',
  'CAMPAIGN_LAUNCH',
  'CAMPAIGN_ENDED',
  'CORRECTION',
] as const;
const audiences = ['ANY', 'NEW_CUSTOMER', 'EXISTING_CUSTOMER'] as const;
const optional = (_: unknown, value: unknown) => value !== undefined;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const utcOffset = /T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export class PromotionTermsDto {
  @ValidateIf(optional)
  @IsInt()
  @Min(1)
  @Max(99)
  percentOff?: number;

  @ValidateIf(optional)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  amountOffMinor?: number;

  @ValidateIf(optional)
  @IsIn(['BRL'])
  currency?: 'BRL';

  @IsISO8601({ strict: true })
  @Matches(utcOffset)
  startsAt!: string;

  @IsISO8601({ strict: true })
  @Matches(utcOffset)
  endsAt!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ArrayUnique()
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/, { each: true })
  planCodes!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(Object.values(BillingInterval), { each: true })
  billingIntervals!: BillingInterval[];

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  totalLimit!: number;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  customerLimit!: number;

  @IsIn(audiences)
  audience!: (typeof audiences)[number];

  @ValidateIf(optional)
  @IsInt()
  @Min(2)
  @Max(12)
  durationMonths?: number;
}

export class PromotionReasonDto {
  @IsIn(reasons)
  reason!: (typeof reasons)[number];
}

export class PromotionVersionDto extends PromotionReasonDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_646)
  expectedVersion!: number;
}

export class CreatePromotionDto extends PromotionReasonDto {
  @Transform(trim)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{2,31}$/)
  code!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name!: string;

  @ValidateIf(
    (_: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(trim)
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => PromotionTermsDto)
  terms!: PromotionTermsDto;
}

export class UpdatePromotionDto extends PromotionVersionDto {
  @ValidateIf(optional)
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name?: string;

  @ValidateIf(
    (_: unknown, value: unknown) => value !== undefined && value !== null,
  )
  @Transform(trim)
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @ValidateIf(optional)
  @IsObject()
  @ValidateNested()
  @Type(() => PromotionTermsDto)
  terms?: PromotionTermsDto;
}

class PromotionPageDto {
  @ValidateIf(optional)
  @Matches(/^(?:[1-9][0-9]{0,3}|10000)$/)
  page?: string;

  @ValidateIf(optional)
  @Matches(/^(?:[1-9][0-9]?|100)$/)
  pageSize?: string;
}

export class PromotionListDto extends PromotionPageDto {
  @ValidateIf(optional)
  @IsIn(promotionStatuses)
  status?: (typeof promotionStatuses)[number];

  @ValidateIf(optional)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/)
  code?: string;
}

export class RedemptionListDto extends PromotionPageDto {
  @ValidateIf(optional)
  @IsIn(redemptionStatuses)
  status?: (typeof redemptionStatuses)[number];
}

export class PromotionSummaryDto {
  @IsIn(billingModes)
  mode!: (typeof billingModes)[number];
}
