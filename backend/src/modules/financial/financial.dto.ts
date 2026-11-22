import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FinancialEntryStatus, FinancialEntryType } from '../../contracts';
import { IsUUIDv7 } from '../../validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/* -------------------------------------------------------------------- */
/* Categorias                                                            */
/* -------------------------------------------------------------------- */

export class CreateFinancialCategoryDto {
  @ApiProperty({ enum: Object.values(FinancialEntryType) })
  @IsIn(Object.values(FinancialEntryType))
  type!: FinancialEntryType;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

/**
 * Atualização de categoria.
 *
 * **`type` não está aqui.** Trocar o lado de uma categoria já usada mudaria o
 * sinal de lançamentos passados sem que ninguém os tocasse — a receita de
 * março viraria despesa retroativamente. Quem errou o lado cria a categoria
 * certa e move os lançamentos.
 */
export class UpdateFinancialCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}

export class FinancialCategoryQueryDto {
  @ApiPropertyOptional({ enum: Object.values(FinancialEntryType) })
  @IsOptional()
  @IsIn(Object.values(FinancialEntryType))
  type?: FinancialEntryType;
}

/* -------------------------------------------------------------------- */
/* Lançamentos                                                           */
/* -------------------------------------------------------------------- */

export class CreateFinancialEntryDto {
  @ApiProperty({ enum: Object.values(FinancialEntryType) })
  @IsIn(Object.values(FinancialEntryType))
  type!: FinancialEntryType;

  /**
   * Situação inicial.
   *
   * `CANCELLED` não é aceito: nasce cancelado é lançamento que nunca precisou
   * existir. O padrão é `PENDING` — quem já recebeu manda `CONFIRMED`.
   */
  @ApiPropertyOptional({
    enum: [FinancialEntryStatus.PENDING, FinancialEntryStatus.CONFIRMED],
    default: FinancialEntryStatus.PENDING,
  })
  @IsOptional()
  @IsIn([FinancialEntryStatus.PENDING, FinancialEntryStatus.CONFIRMED])
  status?: typeof FinancialEntryStatus.PENDING;

  /** Unidade dona do lançamento; a da sessão quando ausente. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  categoryId?: string;

  /** Positivo sempre. O sentido é dado por `type`, não pelo sinal. */
  @ApiProperty({ example: 1250.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999_999_999.99)
  amount!: number;

  @ApiPropertyOptional({ default: 'BRL' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Length(3, 3)
  currency?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  description!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Competência: quando o fato aconteceu. Hoje, quando ausente. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  competenceDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  operationId?: string;
}

/**
 * Edição de lançamento.
 *
 * **`type`, `status`, `source` e `businessUnitId` não estão aqui.** Sentido,
 * situação, procedência e dono não se corrigem por edição: mudam por ato
 * próprio — confirmar, cancelar — que registra quem fez e quando. Um `PATCH`
 * que trocasse o status silenciosamente apagaria essa história.
 */
export class UpdateFinancialEntryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(999_999_999.99)
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  competenceDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dueDate?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  operationId?: string;
}

export class ConfirmFinancialEntryDto {
  /** Data do recebimento/pagamento efetivo. Agora, quando ausente. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  confirmedAt?: Date;
}

/**
 * Cancelamento.
 *
 * O motivo é obrigatório: um valor que sumiu do caixa sem explicação é a
 * pergunta que ninguém consegue responder três meses depois.
 */
export class CancelFinancialEntryDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class FinancialEntryQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  search?: string;

  @ApiPropertyOptional({ enum: Object.values(FinancialEntryType) })
  @IsOptional()
  @IsIn(Object.values(FinancialEntryType))
  type?: FinancialEntryType;

  @ApiPropertyOptional({ enum: Object.values(FinancialEntryStatus) })
  @IsOptional()
  @IsIn(Object.values(FinancialEntryStatus))
  status?: FinancialEntryStatus;

  @ApiPropertyOptional({ enum: ['MANUAL', 'RECEIPT', 'QUOTE', 'SYSTEM'] })
  @IsOptional()
  @IsIn(['MANUAL', 'RECEIPT', 'QUOTE', 'SYSTEM'])
  source?: string;

  /**
   * Registro que originou o lançamento.
   *
   * Existe para responder "qual é a previsão **deste** orçamento" sem trazer
   * páginas de lançamentos para filtrar no cliente — o que erraria assim que o
   * resultado passasse de uma página. A coluna já é indexada por
   * `(organization_id, source, source_entity_id)`.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  sourceEntityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  categoryId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  operationId?: string;

  /** Competência a partir de (inclusive). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Competência até (inclusive). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  /** Somente `PENDING` com vencimento anterior a hoje. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === true || value === 'true',
  )
  @IsBoolean()
  overdue?: boolean;

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

/** Recorte dos relatórios. Sem período, o servidor usa o mês corrente. */
export class FinancialAnalyticsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  /**
   * Agrupamento da série: por mês (padrão) ou por dia — os recortes de 7 e 15
   * dias precisam de barra por dia, e um mês só daria um ponto.
   */
  @ApiPropertyOptional({ enum: ['DAY', 'MONTH'], default: 'MONTH' })
  @IsOptional()
  @IsIn(['DAY', 'MONTH'])
  granularity?: 'DAY' | 'MONTH';
}

/* -------------------------------------------------------------------- */
/* Configuração                                                          */
/* -------------------------------------------------------------------- */

export class UpdateFinancialSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  autoRecordReceipts?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Length(3, 3)
  defaultCurrency?: string;
}
