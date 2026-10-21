import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';

export class FieldOperationCommandDto {
  @ApiProperty()
  @IsUUIDv7()
  commandId!: string;
  @ApiProperty()
  @IsString()
  @MaxLength(120)
  idempotencyKey!: string;
  @ApiProperty()
  @IsString()
  @MaxLength(64)
  expectedVersion!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;
}

export class FieldOperationNoteDto extends FieldOperationCommandDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(2000)
  note!: string;
  @ApiPropertyOptional({
    enum: ['INTERNAL', 'CUSTOMER_VISIBLE'],
    default: 'INTERNAL',
  })
  @IsOptional()
  @IsString()
  visibility?: 'INTERNAL' | 'CUSTOMER_VISIBLE';

  /**
   * De que natureza é o texto.
   *
   * `OBSERVATION` é o que o técnico **constatou** — vai para "Observações da
   * execução" no documento. `REQUEST` é o que o cliente **pediu** ou o que
   * ficou pendente — vai para "Pendências".
   *
   * São duas perguntas que o cliente faz ao ler a OS: o que foi feito, e o que
   * sobrou. Guardá-las no mesmo campo as emendava num parágrafo só, e a
   * pendência se perdia no meio do relato.
   *
   * Omitido é `OBSERVATION`, que é o que todas as notas já gravadas eram.
   */
  @ApiPropertyOptional({
    enum: ['OBSERVATION', 'REQUEST'],
    default: 'OBSERVATION',
  })
  @IsOptional()
  @IsIn(['OBSERVATION', 'REQUEST'])
  kind?: 'OBSERVATION' | 'REQUEST';
}

export class FieldOperationChecklistUpdateDto extends FieldOperationCommandDto {
  @ApiProperty()
  @IsObject()
  answers!: Record<string, unknown>;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  complete?: boolean;
}

export class FieldOperationMaterialDto extends FieldOperationCommandDto {
  /**
   * O produto do catálogo, quando o material é de almoxarifado.
   *
   * **Opcional**, e era obrigatório. Material avulso — a abraçadeira, o metro
   * de fita, o parafuso comprado na esquina — não tem produto cadastrado e não
   * move saldo, e exigir o id obrigava o técnico a inventar um item de catálogo
   * ou a deixar de registrar o que foi aplicado. Sem ele, `description` é o que
   * identifica o material.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  catalogItemId?: string;

  /**
   * O que foi aplicado, em palavras.
   *
   * Exigida quando não há produto de catálogo — é o que o relatório imprime.
   * Com produto, o nome dele é usado e esta fica de lado.
   */
  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(255)
  description?: string;

  /** A unidade do material avulso. Com produto, vem a dele. */
  @ApiPropertyOptional({ maxLength: 20, default: 'UN' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(9_999_999)
  quantity!: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class FieldOperationTimelineQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
