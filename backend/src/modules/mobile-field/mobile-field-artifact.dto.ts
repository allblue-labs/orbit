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
  /**
   * Qual motor desenha. **Omitir é o caminho normal**: o produto escolhe.
   *
   * `pdf.premium` entrou na lista porque ele não estava — pedir o motor premium
   * do aplicativo era recusado pela validação, e o único valor aceito para PDF
   * era justamente o desenho pobre.
   */
  @ApiPropertyOptional({ enum: ['pdf.premium', 'pdf.default', 'html.default'] })
  @IsOptional()
  @IsIn(['pdf.premium', 'pdf.default', 'html.default'])
  renderer?: 'pdf.premium' | 'pdf.default' | 'html.default';
}

export class FieldArtifactAccessQueryDto {
  @ApiPropertyOptional({ enum: ['preview', 'download'] })
  @IsOptional()
  @IsIn(['preview', 'download'])
  operation?: 'preview' | 'download';
}
