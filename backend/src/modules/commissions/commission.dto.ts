/**
 * Entradas da comissão.
 *
 * ## O cliente não manda valor
 *
 * Nenhum DTO de pagamento aceita `amount`. Quem calcula é o servidor, a partir
 * da política e dos atendimentos — aceitar o valor do cliente seria deixar o
 * pagador decidir o preço.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COMMISSION_MODES,
  COMMISSION_PAYMENT_METHODS,
  COMMISSION_PERIODS,
  COMMISSION_ROLES,
  COMMISSION_STATUSES,
} from './commission.read-models';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class SaveCommissionPolicyDto {
  @ApiProperty({ enum: COMMISSION_PERIODS })
  @Transform(upper)
  @IsIn(COMMISSION_PERIODS)
  period!: string;

  @ApiProperty({ enum: COMMISSION_MODES })
  @Transform(upper)
  @IsIn(COMMISSION_MODES)
  mode!: string;

  /**
   * Reais por atendimento ou percentual, conforme `mode`.
   *
   * O teto de 100 vale para os dois: percentual acima de 100 entregaria mais que
   * a receita, e um fixo de seis dígitos é erro de digitação — que o `CHECK` do
   * banco também recusa.
   */
  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000)
  primaryValue!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  @Max(1_000_000)
  assistantValue!: number;

  /** Vazio significa todos os tipos de atendimento. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  eligibleKinds?: string[];

  @ApiProperty()
  @IsBoolean()
  requiresConfirmedRevenue!: boolean;

  @ApiProperty()
  @IsBoolean()
  active!: boolean;
}

export class CommissionQueryDto {
  /** Início do recorte. Ausente, usa a janela vigente da política. */
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;
}

export class CommissionListQueryDto extends CommissionQueryDto {
  /**
   * Recorte por situação.
   *
   * Ausente, devolve as três: a lista serve tanto para pagar quanto para
   * conferir, e separar por padrão obrigaria a tela a somar duas consultas para
   * responder "o que aconteceu com este atendimento?".
   */
  @ApiPropertyOptional({ enum: COMMISSION_STATUSES })
  @IsOptional()
  @Transform(upper)
  @IsIn(COMMISSION_STATUSES)
  status?: string;
}

export class CommissionPaymentQueryDto extends CommissionQueryDto {
  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

/** Uma comissão escolhida: o atendimento e o papel identificam-na. */
export class CommissionSelectionDto {
  @ApiProperty()
  @IsUUID()
  operationId!: string;

  @ApiProperty({ enum: COMMISSION_ROLES })
  @Transform(upper)
  @IsIn(COMMISSION_ROLES)
  role!: string;
}

/**
 * A comissão que se decide não pagar.
 *
 * Identificada como em todo lugar: atendimento, pessoa e papel. Não há `amount`
 * — cancelar é decisão, não valor.
 */
export class CancelCommissionDto {
  @ApiProperty()
  @IsUUID()
  operationId!: string;

  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ enum: COMMISSION_ROLES })
  @Transform(upper)
  @IsIn(COMMISSION_ROLES)
  role!: string;

  /** Por que não vai ser paga. Opcional, e é o que se lê meses depois. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PayCommissionsDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  /**
   * As comissões a pagar.
   *
   * Ausente, paga **todas as pendentes** da janela — que é o caso comum do
   * fechamento. Presente, paga só as escolhidas: uma, ou as marcadas na lista.
   */
  @ApiPropertyOptional({ type: [CommissionSelectionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CommissionSelectionDto)
  selection?: CommissionSelectionDto[];

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: COMMISSION_PAYMENT_METHODS })
  @IsOptional()
  @Transform(upper)
  @IsIn(COMMISSION_PAYMENT_METHODS)
  method?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
