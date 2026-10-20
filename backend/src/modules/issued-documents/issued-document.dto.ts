import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ARTIFACT_RENDER_STATUSES } from '../artifact-executions/artifact-execution.read-models';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export const ISSUED_DOCUMENT_SOURCES = ['EXECUTION', 'REPORT'] as const;

/**
 * Os filtros da central de documentos emitidos.
 *
 * São os mesmos de `ArtifactExecutionQueryDto` onde a pergunta é a mesma — a tela
 * não deve mudar de vocabulário ao ganhar uma segunda origem. O que entra de novo
 * é `source`, para quem quer olhar uma origem por vez.
 *
 * `status` fica de fora de propósito: a execução e o relatório têm máquinas de
 * estado diferentes, e um seletor com os dois vocabulários juntos ofereceria
 * combinações que não existem — "relatório APPROVED" não é um estado.
 */
export class IssuedDocumentQueryDto {
  @ApiPropertyOptional({ enum: ISSUED_DOCUMENT_SOURCES })
  @IsOptional()
  @Transform(upper)
  @IsIn(ISSUED_DOCUMENT_SOURCES)
  source?: (typeof ISSUED_DOCUMENT_SOURCES)[number];

  @ApiPropertyOptional() @IsOptional() @IsUUID() businessUnitId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() operationId?: string;

  @ApiPropertyOptional({ enum: ARTIFACT_RENDER_STATUSES })
  @IsOptional()
  @Transform(upper)
  @IsIn(ARTIFACT_RENDER_STATUSES)
  renderStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(upper)
  @IsString()
  @MaxLength(80)
  artifactType?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
