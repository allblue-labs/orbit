import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

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
