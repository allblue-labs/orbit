import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationDto } from '../../dtos';
import { IsUUIDv7 } from '../../validators';

export const SALE_PAYMENT_LABELS = {
  PIX: 'Pix',
  CASH: 'Dinheiro',
  DEBIT_CARD: 'Cartão de débito',
  CREDIT_CARD: 'Cartão de crédito',
  BANK_TRANSFER: 'Transferência',
  BOLETO: 'Boleto',
  OTHER: 'Outro',
} as const;

const MONEY = /^\d{1,12}(?:\.\d{1,2})?$/;

export class SaleItemDto {
  @IsUUIDv7()
  productId!: string;

  @Matches(/^\d{1,11}(?:\.\d{1,3})?$/)
  quantity!: string;

  @Matches(MONEY)
  unitPrice!: string;
}

export class SalePaymentDto {
  @IsIn(Object.keys(SALE_PAYMENT_LABELS))
  method!: keyof typeof SALE_PAYMENT_LABELS;

  @Matches(MONEY)
  amount!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  installments?: number;
}

export class CreateSaleDto {
  @IsUUID()
  requestId!: string;

  @IsUUIDv7()
  customerId!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  paidOn!: string;

  @IsOptional()
  @Matches(MONEY)
  discount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => SalePaymentDto)
  payments!: SalePaymentDto[];
}

export class SaleProductQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
