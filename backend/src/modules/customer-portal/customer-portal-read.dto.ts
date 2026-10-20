import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const ORDER = ['asc', 'desc'] as const;

export class CustomerPortalListQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({ enum: ORDER, default: 'desc' })
  @IsIn(ORDER)
  order: (typeof ORDER)[number] = 'desc';

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CustomerPortalOperationListQueryDto extends CustomerPortalListQueryDto {
  @ApiPropertyOptional({ enum: ['date', 'createdAt', 'code'] })
  @IsOptional()
  @IsIn(['date', 'createdAt', 'code'])
  sortBy: 'date' | 'createdAt' | 'code' = 'date';

  @ApiPropertyOptional({
    enum: [
      'open',
      'scheduled',
      'inProgress',
      'paused',
      'completed',
      'cancelled',
    ],
  })
  @IsOptional()
  @IsIn(['open', 'scheduled', 'inProgress', 'paused', 'completed', 'cancelled'])
  status?: string;
}

export class CustomerPortalAssetListQueryDto extends CustomerPortalListQueryDto {
  @ApiPropertyOptional({ enum: ['name', 'createdAt'] })
  @IsOptional()
  @IsIn(['name', 'createdAt'])
  sortBy: 'name' | 'createdAt' = 'name';

  @ApiPropertyOptional({
    enum: ['active', 'inactive', 'maintenance', 'retired'],
  })
  @IsOptional()
  @IsIn(['active', 'inactive', 'maintenance', 'retired'])
  status?: string;
}

export class CustomerPortalPmocListQueryDto extends CustomerPortalListQueryDto {
  @ApiPropertyOptional({ enum: ['nextDueOn', 'name', 'createdAt'] })
  @IsOptional()
  @IsIn(['nextDueOn', 'name', 'createdAt'])
  sortBy: 'nextDueOn' | 'name' | 'createdAt' = 'nextDueOn';

  @ApiPropertyOptional({
    enum: ['draft', 'active', 'suspended', 'expired', 'cancelled'],
  })
  @IsOptional()
  @IsIn(['draft', 'active', 'suspended', 'expired', 'cancelled'])
  status?: string;
}

export class CustomerPortalRvtListQueryDto extends CustomerPortalListQueryDto {
  @ApiPropertyOptional({ enum: ['coverageStart', 'name', 'createdAt'] })
  @IsOptional()
  @IsIn(['coverageStart', 'name', 'createdAt'])
  sortBy: 'coverageStart' | 'name' | 'createdAt' = 'coverageStart';

  @ApiPropertyOptional({
    enum: ['active', 'inactive', 'completed', 'cancelled'],
  })
  @IsOptional()
  @IsIn(['active', 'inactive', 'completed', 'cancelled'])
  status?: string;
}

export class CustomerPortalDocumentListQueryDto extends CustomerPortalListQueryDto {
  @ApiPropertyOptional({ enum: ['issuedAt', 'fileName'] })
  @IsOptional()
  @IsIn(['issuedAt', 'fileName'])
  sortBy: 'issuedAt' | 'fileName' = 'issuedAt';
}
