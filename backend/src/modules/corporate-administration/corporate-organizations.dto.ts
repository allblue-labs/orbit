import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PlatformOrganizationMetadataDto } from '../platform-administration/dto/platform-administration.dto';
import { SubscriptionStatus } from '../subscription-plans/subscriptions/subscription.types';

const whenProvided = (_: unknown, value: unknown) => value !== undefined;
const utcTimestamp =
  /^(?!0000)\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/;
const operationalStatuses = ['ACTIVE', 'ONBOARDING', 'SUSPENDED', 'CANCELLED'];
const subscriptionStatuses = ['UNKNOWN', ...Object.values(SubscriptionStatus)];

export class CorporateOrganizationQueryDto {
  @ValidateIf(whenProvided)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  q?: string;

  @ValidateIf(whenProvided)
  @IsIn(operationalStatuses)
  operationalStatus?: string;

  @ValidateIf(whenProvided)
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  planCode?: string;

  @ValidateIf(whenProvided)
  @IsIn(subscriptionStatuses)
  subscriptionStatus?: string;

  @ValidateIf(whenProvided)
  @Matches(utcTimestamp)
  @IsISO8601({ strict: true })
  registeredFrom?: string;

  @ValidateIf(whenProvided)
  @Matches(utcTimestamp)
  @IsISO8601({ strict: true })
  registeredBefore?: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 25;

  @IsIn(['registeredAt', 'displayName'])
  sort = 'registeredAt';

  @IsIn(['asc', 'desc'])
  direction = 'desc';
}

export class UpdateCorporateOrganizationDto extends PlatformOrganizationMetadataDto {
  @Matches(utcTimestamp)
  @IsISO8601({ strict: true })
  expectedUpdatedAt!: string;
}
