import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  FIELD_ARTIFACT_SOURCE_TYPES,
  type FieldArtifactSourceType,
} from './mobile-field-artifact.read-models';

export class FieldArtifactSourceQueryDto {
  @ApiProperty({ enum: FIELD_ARTIFACT_SOURCE_TYPES })
  @IsIn(FIELD_ARTIFACT_SOURCE_TYPES)
  sourceType!: FieldArtifactSourceType;
}

export class PrepareFieldArtifactDto extends FieldArtifactSourceQueryDto {}

export class RenderFieldArtifactDto {
  @ApiPropertyOptional({ enum: ['pdf.default', 'html.default'] })
  @IsOptional()
  @IsIn(['pdf.default', 'html.default'])
  renderer?: 'pdf.default' | 'html.default';
}

export class FieldArtifactAccessQueryDto {
  @ApiPropertyOptional({ enum: ['preview', 'download'] })
  @IsOptional()
  @IsIn(['preview', 'download'])
  operation?: 'preview' | 'download';
}
