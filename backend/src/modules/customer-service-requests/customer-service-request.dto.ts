import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OperationKind } from '../../contracts';
import { IsUUIDv7 } from '../../validators';
import {
  CUSTOMER_SERVICE_REQUEST_CATEGORIES,
  CUSTOMER_SERVICE_REQUEST_STATUSES,
  type CustomerServiceRequestCategory,
  type CustomerServiceRequestStatus,
} from './customer-service-request.types';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateCustomerServiceRequestDto {
  @ApiProperty({ enum: CUSTOMER_SERVICE_REQUEST_CATEGORIES })
  @IsIn(CUSTOMER_SERVICE_REQUEST_CATEGORIES)
  category!: CustomerServiceRequestCategory;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(180)
  subject!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  description!: string;

  @ApiPropertyOptional({
    description: 'Equipamento pertencente ao Customer autenticado',
  })
  @IsOptional()
  @IsUUIDv7()
  assetId?: string;
}

export class CustomerServiceRequestPortalQueryDto {
  @ApiPropertyOptional({ enum: CUSTOMER_SERVICE_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(CUSTOMER_SERVICE_REQUEST_STATUSES)
  status?: CustomerServiceRequestStatus;

  @ApiPropertyOptional({ enum: CUSTOMER_SERVICE_REQUEST_CATEGORIES })
  @IsOptional()
  @IsIn(CUSTOMER_SERVICE_REQUEST_CATEGORIES)
  category?: CustomerServiceRequestCategory;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class CustomerServiceRequestInternalQueryDto extends CustomerServiceRequestPortalQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  assignedToUserId?: string;
}

export class ExpectedVersionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

export class TriageCustomerServiceRequestDto extends ExpectedVersionDto {
  @ApiPropertyOptional({ enum: CUSTOMER_SERVICE_REQUEST_CATEGORIES })
  @IsOptional()
  @IsIn(CUSTOMER_SERVICE_REQUEST_CATEGORIES)
  category?: CustomerServiceRequestCategory;

  @ApiPropertyOptional({
    description: 'Equipamento do mesmo Customer; a BU é derivada dele',
  })
  @IsOptional()
  @IsUUIDv7()
  assetId?: string;
}

export class CustomerServiceRequestMessageDto extends ExpectedVersionDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}

export class AssignCustomerServiceRequestDto extends ExpectedVersionDto {
  @ApiProperty()
  @IsUUIDv7()
  userId!: string;
}

export class ChangeCustomerServiceRequestStatusDto extends ExpectedVersionDto {
  @ApiProperty({ enum: CUSTOMER_SERVICE_REQUEST_STATUSES })
  @IsIn(CUSTOMER_SERVICE_REQUEST_STATUSES)
  status!: CustomerServiceRequestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;
}

export class ConvertCustomerServiceRequestDto extends ExpectedVersionDto {
  @ApiProperty()
  @IsUUIDv7()
  businessUnitId!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  code!: string;

  @ApiProperty({ enum: Object.values(OperationKind) })
  @IsIn(Object.values(OperationKind))
  kind!: OperationKind;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(220)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  description?: string;
}
