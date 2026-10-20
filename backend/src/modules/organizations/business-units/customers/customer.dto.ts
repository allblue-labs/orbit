import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CustomerStatus, CustomerType } from '../../../../contracts';
import { IsDocument, IsUUIDv7 } from '../../../../validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CustomerQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  search?: string;

  @ApiPropertyOptional({ enum: Object.values(CustomerType) })
  @IsOptional()
  @IsIn(Object.values(CustomerType))
  type?: CustomerType;

  @ApiPropertyOptional({ enum: Object.values(CustomerStatus) })
  @IsOptional()
  @IsIn(Object.values(CustomerStatus))
  status?: CustomerStatus;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CreateCustomerDto {
  @ApiProperty({ enum: Object.values(CustomerType) })
  @IsIn(Object.values(CustomerType))
  type!: CustomerType;

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

  @ApiPropertyOptional({ enum: ['CPF', 'CNPJ'] })
  @ValidateIf((input: CreateCustomerDto) => Boolean(input.documentNumber))
  @IsIn(['CPF', 'CNPJ'])
  documentType?: string;

  @ApiPropertyOptional()
  @ValidateIf((input: CreateCustomerDto) => Boolean(input.documentType))
  @IsDocument()
  documentNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  address?: Record<string, unknown>;
}

export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {
  @ApiPropertyOptional({ enum: Object.values(CustomerStatus) })
  @IsOptional()
  @IsIn(Object.values(CustomerStatus))
  status?: CustomerStatus;
}

export class CreateContactDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  role?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateContactDto extends PartialType(CreateContactDto) {}

/* ------------------------------------------------------------------ */
/* Endereços de atendimento                                            */
/* ------------------------------------------------------------------ */

/**
 * Um endereço para onde o técnico vai.
 *
 * Separado de `Customer.address`, que é o endereço **fiscal** — o que vai na
 * nota. Uma rede com três lojas é um cliente e três endereços de atendimento.
 */
export class CreateCustomerAddressDto {
  @ApiProperty({ description: 'Como a equipe chama este lugar' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  street!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  city!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  complement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2)
  stateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(16)
  postalCode?: string;

  /** Portaria, ponto de referência, instruções de acesso. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateCustomerAddressDto extends PartialType(
  CreateCustomerAddressDto,
) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
