import { IsDateString, IsOptional, Matches } from 'class-validator';
import { FinanceModeDto } from './corporate-finance.dto';

class AnalyticsCurrencyDto extends FinanceModeDto {
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}

export class AnalyticsRecurringDto extends AnalyticsCurrencyDto {
  @IsOptional()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/)
  planCode?: string;
}

export class AnalyticsLifecycleDto extends AnalyticsCurrencyDto {
  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  from!: string;

  @Matches(/^(?!0000)\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  to!: string;
}

export class AnalyticsPeriodDto extends AnalyticsLifecycleDto {
  @IsOptional()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/)
  planCode?: string;
}
