import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsPositive,
  Min,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreatePlanDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  key!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  monthlyPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  annualPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ type: String, isArray: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  limits?: Record<string, number | null>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}

export class RecordUsageDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  resource!: string;

  @ApiProperty()
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ enum: ['CONSUME', 'RESERVE', 'RELEASE'] })
  @IsIn(['CONSUME', 'RESERVE', 'RELEASE'])
  operation!: 'CONSUME' | 'RESERVE' | 'RELEASE';
}
