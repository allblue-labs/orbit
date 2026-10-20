import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';
import {
  FIELD_EVIDENCE_CATEGORIES,
  FIELD_EVIDENCE_SOURCES,
  FIELD_EVIDENCE_TARGETS,
} from './mobile-evidence.read-models';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class FieldEvidenceTargetDto {
  @ApiProperty({ enum: FIELD_EVIDENCE_TARGETS })
  @IsIn(FIELD_EVIDENCE_TARGETS)
  type!: (typeof FIELD_EVIDENCE_TARGETS)[number];

  @ApiProperty()
  @IsUUIDv7()
  id!: string;
}

export class CreateFieldEvidenceUploadDto {
  @ApiProperty({ type: FieldEvidenceTargetDto })
  @ValidateNested()
  @Type(() => FieldEvidenceTargetDto)
  target!: FieldEvidenceTargetDto;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename!: string;

  @ApiProperty({
    enum: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
  })
  @IsIn(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  declaredMimeType!: string;

  @ApiProperty({ maximum: 100_000_000 })
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  declaredSize!: number;

  @ApiPropertyOptional({ enum: FIELD_EVIDENCE_CATEGORIES })
  @IsOptional()
  @IsIn(FIELD_EVIDENCE_CATEGORIES)
  category?: (typeof FIELD_EVIDENCE_CATEGORIES)[number];

  @ApiPropertyOptional({ enum: FIELD_EVIDENCE_SOURCES })
  @IsOptional()
  @IsIn(FIELD_EVIDENCE_SOURCES)
  source?: (typeof FIELD_EVIDENCE_SOURCES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  capturedAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  localMediaId?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(8)
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'SHA-256 esperado pelo device.' })
  @IsOptional()
  @Matches(/^[a-fA-F0-9]{64}$/)
  expectedSha256?: string;
}

export class FinalizeFieldEvidenceUploadDto {
  @ApiPropertyOptional({ description: 'Repetição opcional do SHA esperado.' })
  @IsOptional()
  @Matches(/^[a-fA-F0-9]{64}$/)
  expectedSha256?: string;
}

export class ListFieldEvidenceDto {
  @ApiProperty({ enum: FIELD_EVIDENCE_TARGETS })
  @IsIn(FIELD_EVIDENCE_TARGETS)
  targetType!: (typeof FIELD_EVIDENCE_TARGETS)[number];

  @ApiProperty()
  @IsUUIDv7()
  targetId!: string;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
