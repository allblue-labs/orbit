import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class EquipmentServiceHistoryQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 10;
}

export class EquipmentQrRenderQueryDto {
  @ApiPropertyOptional({ enum: ['svg', 'png', 'pdf'], default: 'svg' })
  @IsOptional()
  @IsIn(['svg', 'png', 'pdf'])
  format: 'svg' | 'png' | 'pdf' = 'svg';

  @ApiPropertyOptional({ enum: ['SMALL', 'STANDARD'], default: 'STANDARD' })
  @IsOptional()
  @IsIn(['SMALL', 'STANDARD'])
  preset: 'SMALL' | 'STANDARD' = 'STANDARD';

  @ApiPropertyOptional({
    enum: ['NONE', 'ORGANIZATION', 'BUSINESS_UNIT'],
    default: 'NONE',
  })
  @IsOptional()
  @IsIn(['NONE', 'ORGANIZATION', 'BUSINESS_UNIT'])
  branding: 'NONE' | 'ORGANIZATION' | 'BUSINESS_UNIT' = 'NONE';
}
