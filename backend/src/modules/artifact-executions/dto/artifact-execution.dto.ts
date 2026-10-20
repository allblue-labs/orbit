import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  Allow,
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/* A lista dos estados de emissão vive nos read models do módulo — o DTO a
   reusa em vez de repetir cinco strings que sairiam de sincronia. */
import { ARTIFACT_RENDER_STATUSES } from '../artifact-execution.read-models';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const idPattern = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

export const ARTIFACT_EXECUTION_STATUSES = [
  'DRAFT',
  'IN_PROGRESS',
  'PAUSED',
  'UNDER_REVIEW',
  'APPROVED',
  'COMPLETED',
  'ARCHIVED',
] as const;
export type ArtifactExecutionStatus =
  (typeof ARTIFACT_EXECUTION_STATUSES)[number];

export class ExecutionTeamMemberDto {
  @ApiProperty() @IsUUID() userId!: string;
  @ApiPropertyOptional({ default: 'MEMBER' })
  @IsOptional()
  @Transform(upper)
  @Matches(/^[A-Z][A-Z0-9_.-]*$/)
  role = 'MEMBER';
}

export class CreateArtifactExecutionDto {
  @ApiProperty() @IsUUID() businessUnitId!: string;
  @ApiProperty() @IsUUID() templateId!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  templateVersion?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() operationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() responsibleUserId?: string;
  @ApiProperty()
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z0-9][A-Z0-9_-]*$/)
  @MaxLength(80)
  code!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(220) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledEnd?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  context: Record<string, unknown> = {};
  @ApiPropertyOptional({ type: [ExecutionTeamMemberDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExecutionTeamMemberDto)
  team: ExecutionTeamMemberDto[] = [];
}

class ArtifactExecutionMetadataDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(220)
  title?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() responsibleUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledStart?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() scheduledEnd?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
  @ApiPropertyOptional({ type: [ExecutionTeamMemberDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ExecutionTeamMemberDto)
  team?: ExecutionTeamMemberDto[];
}
export class UpdateArtifactExecutionDto extends PartialType(
  ArtifactExecutionMetadataDto,
) {}

export class ChangeArtifactExecutionStatusDto {
  @ApiProperty({ enum: ARTIFACT_EXECUTION_STATUSES })
  @Transform(upper)
  @IsIn(ARTIFACT_EXECUTION_STATUSES)
  status!: ArtifactExecutionStatus;
}

export class SaveArtifactResponseDto {
  @ApiProperty()
  @IsString()
  @Matches(idPattern)
  @MaxLength(120)
  sectionId!: string;
  @ApiProperty()
  @IsString()
  @Matches(idPattern)
  @MaxLength(120)
  fieldId!: string;
  @ApiProperty() @Allow() value!: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) unit?: string;
  @ApiPropertyOptional({ enum: ['USER', 'SENSOR', 'IMPORT', 'SYSTEM', 'AI'] })
  @IsOptional()
  @IsIn(['USER', 'SENSOR', 'IMPORT', 'SYSTEM', 'AI'])
  provenance = 'USER';
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

export class RegisterArtifactAttachmentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() responseId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(idPattern)
  @MaxLength(120)
  sectionId?: string;
  @ApiProperty({ enum: ['IMAGE', 'VIDEO', 'DOCUMENT'] })
  @Transform(upper)
  @IsIn(['IMAGE', 'VIDEO', 'DOCUMENT'])
  kind!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) fileName!: string;
  @ApiProperty() @IsString() @MaxLength(160) mimeType!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(5_000_000_000) sizeBytes!: number;
  @ApiProperty() @IsString() @MaxLength(500) storageKey!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  checksum?: string;
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata: Record<string, unknown> = {};
}

export class CollectArtifactSignatureDto {
  @ApiProperty()
  @IsString()
  @Matches(idPattern)
  @MaxLength(120)
  slotId!: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(180) signerName!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  signerDocument?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({
    enum: ['FIELD_TECHNICIAN', 'TECHNICAL_RESPONSIBLE', 'CUSTOMER'],
  })
  @IsOptional()
  @IsIn(['FIELD_TECHNICIAN', 'TECHNICAL_RESPONSIBLE', 'CUSTOMER'])
  signedAs?: 'FIELD_TECHNICIAN' | 'TECHNICAL_RESPONSIBLE' | 'CUSTOMER';
  @ApiProperty({ type: Object }) @IsObject() signatureData!: Record<
    string,
    unknown
  >;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  consentText?: string;
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  geolocation?: Record<string, unknown>;
}

export class ArtifactExecutionQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() businessUnitId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() operationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() assetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() responsibleUserId?: string;
  @ApiPropertyOptional({ enum: ARTIFACT_EXECUTION_STATUSES })
  @IsOptional()
  @IsIn(ARTIFACT_EXECUTION_STATUSES)
  status?: string;
  /**
   * Estado da emissão, que não é o status da execução.
   *
   * Uma execução aprovada pode não ter documento, e uma em revisão pode ter uma
   * emissão falhada. A central documental pergunta pelo documento; sem este
   * filtro ela só podia agrupar a página carregada, e a contagem de cada fila
   * era a da página, não da organização.
   */
  @ApiPropertyOptional({ enum: ARTIFACT_RENDER_STATUSES })
  @IsOptional()
  @IsIn(ARTIFACT_RENDER_STATUSES)
  renderStatus?: string;
  /**
   * Tipo do artefato, como o snapshot congelou.
   *
   * O filtro é pelo snapshot e não pelo template: o tipo do documento emitido é
   * o que valia quando a execução nasceu. Trocar o `artifactType` do template
   * depois não deve reescrever o passado da listagem.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Transform(upper)
  artifactType?: string;
  /** Início do período, pela criação da execução. Inclusivo. */
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;
  /** Fim do período. Inclusivo — ver `endOfDay` no repositório. */
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  search?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
