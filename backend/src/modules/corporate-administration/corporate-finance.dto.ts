import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ProviderInvoiceStatus } from '../billing/billing.types';

export class FinanceModeDto {
  @IsIn(['TEST', 'LIVE'])
  mode!: 'TEST' | 'LIVE';
}
export class FinanceDetailDto extends FinanceModeDto {
  @IsOptional()
  @IsIn(['true'])
  includeOrganizationName?: 'true';
}

export class FinancePeriodDto extends FinanceModeDto {
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to!: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/)
  planCode?: string;
}

class FinancePageDto extends FinancePeriodDto {
  @IsOptional()
  @IsIn(['true'])
  includeOrganizationName?: 'true';

  @IsOptional()
  @Matches(/^(?:[1-9]\d{0,3}|10000)$/)
  page?: string;

  @IsOptional()
  @Matches(/^(?:[1-9]\d?|100)$/)
  pageSize?: string;

  @IsOptional()
  @IsIn(['DATE_ASC', 'DATE_DESC', 'AMOUNT_ASC', 'AMOUNT_DESC'])
  sort?: 'DATE_ASC' | 'DATE_DESC' | 'AMOUNT_ASC' | 'AMOUNT_DESC';
}

export class FinanceInvoiceListDto extends FinancePageDto {
  @IsOptional()
  @IsIn(Object.values(ProviderInvoiceStatus))
  status?: ProviderInvoiceStatus;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  search?: string;
}

export class FinancePaymentListDto extends FinancePageDto {
  @IsOptional()
  @IsUUID()
  invoiceId?: string;

  @IsOptional()
  @IsIn(['RECEIPT', 'ATTEMPT', 'REFUND', 'DISPUTE'])
  kind?: 'RECEIPT' | 'ATTEMPT' | 'REFUND' | 'DISPUTE';

  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{0,39}$/)
  status?: string;
}
