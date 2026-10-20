import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OperationKind } from '../../contracts';
import { IsUUIDv7 } from '../../validators';

export const ChecklistItemType = {
  BOOLEAN: 'BOOLEAN',
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  SELECT: 'SELECT',
  PHOTO: 'PHOTO',
  SIGNATURE: 'SIGNATURE',
} as const;
export const ChecklistExecutionStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ChecklistItemDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(220)
  label!: string;

  @IsIn(Object.values(ChecklistItemType))
  type!: (typeof ChecklistItemType)[keyof typeof ChecklistItemType];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsObject()
  validation?: Record<string, unknown>;
}

export class CreateChecklistTemplateDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * O tipo de atendimento a que este modelo pertence.
   *
   * Omitido, o modelo serve a qualquer tipo — é o que todo modelo era antes
   * desta coluna existir, e continua valendo. Quando presente, é o que faz o
   * formulário de nova operação achar o checklist ao escolher o tipo.
   */
  @ApiPropertyOptional({ enum: Object.values(OperationKind) })
  @IsOptional()
  @IsIn(Object.values(OperationKind))
  operationKind?: OperationKind;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  items!: ChecklistItemDto[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateChecklistTemplateDto extends PartialType(
  CreateChecklistTemplateDto,
) {}

export class ChecklistTemplateQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(180)
  search?: string;

  /** Só os modelos deste tipo de atendimento. */
  @IsOptional()
  @IsIn(Object.values(OperationKind))
  operationKind?: OperationKind;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isActive?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class StartChecklistExecutionDto {
  @ApiProperty()
  @IsUUIDv7()
  templateId!: string;

  /**
   * Itens além dos do modelo, só para esta execução.
   *
   * O modelo é do **dono da organização** e não muda porque um atendimento
   * pediu uma verificação a mais: os extras entram no snapshot desta
   * execução, ao lado dos herdados, e o modelo segue intacto para o próximo.
   */
  @ApiPropertyOptional({ type: [ChecklistItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ChecklistItemDto)
  additionalItems?: ChecklistItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class SaveChecklistAnswersDto {
  @IsObject()
  answers!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ChecklistExecutionQueryDto {
  @IsOptional()
  @IsUUIDv7()
  operationId?: string;

  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @IsOptional()
  @IsIn(Object.values(ChecklistExecutionStatus))
  status?: (typeof ChecklistExecutionStatus)[keyof typeof ChecklistExecutionStatus];

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
