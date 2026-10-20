import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';

/** `YYYY-MM-DD`, que é como uma data civil viaja. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const MOBILE_QUEUE_VIEWS = [
  'ALL',
  'TODAY',
  'OVERDUE',
  'IN_PROGRESS',
  'UPCOMING',
] as const;
export const MOBILE_WORK_ITEM_KINDS = [
  'SERVICE_OPERATION',
  'PMOC',
  'RVT',
] as const;

export class MobileWorkQueueQueryDto {
  @ApiPropertyOptional({ enum: MOBILE_QUEUE_VIEWS, default: 'ALL' })
  @IsOptional()
  @IsIn(MOBILE_QUEUE_VIEWS)
  view?: (typeof MOBILE_QUEUE_VIEWS)[number];

  @ApiPropertyOptional({ enum: MOBILE_WORK_ITEM_KINDS })
  @IsOptional()
  @IsIn(MOBILE_WORK_ITEM_KINDS)
  kind?: (typeof MOBILE_WORK_ITEM_KINDS)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  /// Busca livre por cliente, título ou código.
  @ApiPropertyOptional({ example: 'Shopping' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  /// Só os atendimentos deste cliente.
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  /// Início da janela de datas, inclusive.
  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  /// Fim da janela de datas, inclusive.
  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

/** Os tipos de documento que a tela de Documentos filtra. */
export const MOBILE_DOCUMENT_TYPES = ['SERVICE_ORDER', 'PMOC', 'RVT'] as const;

export class MobileDocumentsQueryDto {
  @ApiPropertyOptional({ enum: MOBILE_DOCUMENT_TYPES })
  @IsOptional()
  @IsIn(MOBILE_DOCUMENT_TYPES)
  type?: (typeof MOBILE_DOCUMENT_TYPES)[number];

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  /// Busca por cliente ou título do documento.
  @ApiPropertyOptional({ example: 'Shopping' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

/// Recortes da base de clientes.
export class MobileFieldCustomersQueryDto {
  @ApiPropertyOptional({ example: 'Shopping' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;
}
