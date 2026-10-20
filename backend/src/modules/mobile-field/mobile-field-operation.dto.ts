import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsBoolean,
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
  @ApiProperty()
  @IsUUIDv7()
  catalogItemId!: string;
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
