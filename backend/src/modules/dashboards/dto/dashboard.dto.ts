import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { IsUUIDv7 } from '../../../validators';

export const DashboardRange = {
  SEVEN_DAYS: '7D',
  THIRTY_DAYS: '30D',
  NINETY_DAYS: '90D',
} as const;

export class DashboardQueryDto {
  @ApiPropertyOptional({
    enum: Object.values(DashboardRange),
    default: DashboardRange.THIRTY_DAYS,
  })
  @IsOptional()
  @IsIn(Object.values(DashboardRange))
  range: string = DashboardRange.THIRTY_DAYS;

  @ApiPropertyOptional({
    description: 'Comma-separated widget tags',
    example: 'environment,intelligence',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((tag) => tag.trim().toLowerCase())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];
}

/** Filtros das listas de atividades e próximos compromissos. */
export class DashboardFeedQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  /** Só para os próximos compromissos: quantos dias à frente. */
  @ApiPropertyOptional({ minimum: 1, maximum: 60, default: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  days?: number;
}
