import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsDefined,
  ValidateIf,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BusinessUnitType } from '../../../contracts';
import { IsDocument } from '../../../validators';
import { BillingInterval } from '../../subscription-plans/catalog/plan-catalog.types';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const email = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class PlatformTenantOwnerDto {
  @ApiProperty()
  @Transform(email)
  @IsEmail()
  email!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName!: string;

  @ApiPropertyOptional({
    minLength: 12,
    deprecated: true,
    description: 'Preferir setup de senha por e-mail.',
  })
  @IsOptional()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password?: string;
}

export class PlatformPrimaryBusinessUnitDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  legalName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  tradeName?: string;

  @ApiProperty({ enum: Object.values(BusinessUnitType) })
  @IsIn(Object.values(BusinessUnitType))
  type: BusinessUnitType = BusinessUnitType.HEADQUARTERS;

  @ApiProperty({ enum: ['CPF', 'CNPJ'] })
  @IsIn(['CPF', 'CNPJ'])
  documentType!: string;

  @ApiProperty()
  @IsDocument()
  documentNumber!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  city!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  street!: string;

  @ApiProperty()
  @Length(2, 2)
  stateCode!: string;
}

export class CreatePlatformTenantDto {
  @ApiProperty({ type: PlatformTenantOwnerDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PlatformTenantOwnerDto)
  owner!: PlatformTenantOwnerDto;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  organizationName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  primarySegment!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  planKey!: string;

  @ApiPropertyOptional({ enum: Object.values(BillingInterval) })
  @IsOptional()
  @IsIn(Object.values(BillingInterval))
  billingInterval: BillingInterval = BillingInterval.MONTHLY;

  @ApiProperty({ type: PlatformPrimaryBusinessUnitDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => PlatformPrimaryBusinessUnitDto)
  primaryBusinessUnit!: PlatformPrimaryBusinessUnitDto;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'ONBOARDING', 'SUSPENDED'],
    default: 'ACTIVE',
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'ONBOARDING', 'SUSPENDED'])
  organizationStatus = 'ACTIVE';

  @ApiPropertyOptional({
    enum: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED'],
    readOnly: true,
    deprecated: true,
  })
  @IsOptional()
  @IsIn(['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED'])
  subscriptionStatus?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    readOnly: true,
    deprecated: true,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  currentPeriodEnd?: Date;

  @ApiPropertyOptional({ readOnly: true, deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  externalCustomerId?: string;

  @ApiPropertyOptional({ readOnly: true, deprecated: true })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  externalSubscriptionId?: string;
}

export class PlatformListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;
}

export class UpdatePlatformOrganizationDto {
  @ApiPropertyOptional()
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  displayName?: string;

  @ApiPropertyOptional()
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  primarySegment?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      'Obrigatório para alterações cadastrais; valor de updatedAt da consulta.',
  })
  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @Type(() => Date)
  @IsDate()
  expectedUpdatedAt?: Date;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'ONBOARDING', 'SUSPENDED', 'CANCELLED'],
    readOnly: true,
    deprecated: true,
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'ONBOARDING', 'SUSPENDED', 'CANCELLED'])
  status?: string;

  @ApiPropertyOptional({
    enum: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED'],
    readOnly: true,
    deprecated: true,
  })
  @IsOptional()
  @IsIn(['TRIALING', 'ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED'])
  subscriptionStatus?: string;

  @ApiPropertyOptional({ readOnly: true, deprecated: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  planKey?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    readOnly: true,
    deprecated: true,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  currentPeriodEnd?: Date;
}
