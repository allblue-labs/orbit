import {
  ApiProperty,
  ApiPropertyOptional,
  OmitType,
  PartialType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
  ValidateNested,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';
import { CursorDto } from '../../dtos/foundation.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class RvtConfigurationQueryDto extends CursorDto {
  @ApiPropertyOptional() @IsOptional() @IsUUIDv7() businessUnitId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUIDv7() customerId?: string;
  @ApiPropertyOptional({
    enum: ['ACTIVE', 'INACTIVE', 'COMPLETED', 'CANCELLED'],
  })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'COMPLETED', 'CANCELLED'])
  status?: string;
}

export class RvtOccurrenceQueryDto extends CursorDto {
  @ApiPropertyOptional() @IsOptional() @IsUUIDv7() businessUnitId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUIDv7() assignedToUserId?: string;
  @ApiPropertyOptional({
    enum: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  })
  @IsOptional()
  @IsIn(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  status?: string;
}
export class RvtTimelineQueryDto extends CursorDto {}

export class CreateRvtConfigurationDto {
  @ApiProperty() @IsUUIDv7() businessUnitId!: string;
  @ApiProperty() @IsUUIDv7() customerId!: string;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  code!: string;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(220)
  name!: string;
  /**
   * O tipo de manutenção contratado.
   *
   * Substitui `visitType`, que era um literal de dois valores — semanal e
   * semestral — e governava a cadência das visitas. O tipo é cadastro da
   * organização e carrega o próprio intervalo, então mensal, trimestral e anual
   * deixam de exigir migração e um `if` novo no domínio.
   */
  @IsUUIDv7()
  maintenanceTypeId!: string;
  @ApiProperty({ enum: ['RECURRING', 'ONE_TIME'] })
  @IsIn(['RECURRING', 'ONE_TIME'])
  scheduleMode!: 'RECURRING' | 'ONE_TIME';
  @ApiProperty() @Matches(DATE) coverageStart!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) coverageEnd?: string;
  @ApiProperty({ example: 'America/Recife' })
  @IsString()
  @MaxLength(80)
  timezone!: string;
  @ApiProperty({ type: Object }) @IsObject() serviceLocation!: Record<
    string,
    unknown
  >;
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  recurrence?: Record<string, unknown>;
  @ApiProperty({ type: Object }) @IsObject() procedure!: Record<
    string,
    unknown
  >;
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  technicalResponsibleUserId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  defaultResponsibleFieldTechnicianId?: string;
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresTechnicalResponsible?: boolean;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUIDv7({ each: true })
  equipmentIds?: string[];
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateRvtConfigurationDto extends PartialType(
  CreateRvtConfigurationDto,
) {
  override businessUnitId?: never;
  override customerId?: never;
  override code?: never;
  override scheduleMode?: never;
}

export class StartRvtExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  responsibleFieldTechnicianId?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUIDv7({ each: true })
  auxiliaryTechnicianIds?: string[];
}

export class UpdateRvtExecutionDto {
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  procedure?: Record<string, unknown>;
  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  observations?: Record<string, unknown>[];
  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  recommendations?: Record<string, unknown>[];
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  freeTextRecommendation?: string;
}

export class AddRvtEquipmentDto {
  @ApiProperty() @IsUUIDv7() assetId!: string;
}

export class RegisterRvtEquipmentDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name!: string;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  category!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  manufacturer?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  model?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  serialNumber?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  location?: string;
}

export class AddRvtEvidenceDto {
  @ApiProperty() @IsUUIDv7() storageFileId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUIDv7() assetId?: string;
  @ApiPropertyOptional({ default: 'PHOTO' })
  @IsOptional()
  @IsIn(['PHOTO', 'VIDEO', 'DOCUMENT'])
  kind?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  caption?: string;
}

export class CaptureCustomerAcknowledgementDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name!: string;
  @ApiProperty() @IsUUIDv7() storageFileId!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) signedAt?: Date;
}

export class CompleteRvtExecutionDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) performedAt?: Date;
}

export class ContextualRvtCustomerDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  legalName!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  tradeName?: string;
  @ApiPropertyOptional({ enum: ['COMPANY', 'INDIVIDUAL'] })
  @IsOptional()
  @IsIn(['COMPANY', 'INDIVIDUAL'])
  type?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  documentNumber?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  phone?: string;
  @ApiProperty({ type: Object }) @IsObject() address!: Record<string, unknown>;
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  contactName?: string;
}

export class ContextualRvtEquipmentDto extends RegisterRvtEquipmentDto {}

export class CreateAdHocRvtDto extends StartRvtExecutionDto {
  @ApiProperty() @IsUUIDv7() businessUnitId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUIDv7() customerId?: string;
  @ApiPropertyOptional({ type: () => ContextualRvtCustomerDto })
  @IsOptional()
  @Type(() => ContextualRvtCustomerDto)
  @ValidateNested()
  customer?: ContextualRvtCustomerDto;
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(220)
  name!: string;
  /**
   * O tipo de manutenção contratado.
   *
   * Substitui `visitType`, que era um literal de dois valores — semanal e
   * semestral — e governava a cadência das visitas. O tipo é cadastro da
   * organização e carrega o próprio intervalo, então mensal, trimestral e anual
   * deixam de exigir migração e um `if` novo no domínio.
   */
  @IsUUIDv7()
  maintenanceTypeId!: string;
  @ApiProperty({ example: 'America/Recife' }) @IsString() timezone!: string;
  @ApiProperty({ type: Object }) @IsObject() serviceLocation!: Record<
    string,
    unknown
  >;
  @ApiProperty({ type: Object }) @IsObject() procedure!: Record<
    string,
    unknown
  >;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUIDv7({ each: true })
  equipmentIds?: string[];
  @ApiPropertyOptional({ type: () => ContextualRvtEquipmentDto })
  @IsOptional()
  @Type(() => ContextualRvtEquipmentDto)
  @ValidateNested()
  equipment?: ContextualRvtEquipmentDto;
}

/* ------------------------------------------------------------------ */
/* Tipos de manutenção                                                 */
/* ------------------------------------------------------------------ */

/**
 * Um ritmo de manutenção da organização — semanal, mensal, trimestral…
 *
 * A cadência é dado, e não literal no código: acrescentar "quadrimestral" é
 * cadastro, não migração.
 */
export class CreateRvtMaintenanceTypeDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  key!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  label!: string;

  /** Cadência em dias. Exclusivo com `intervalMonths`. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  intervalDays?: number;

  /** Cadência em meses de calendário. Exclusivo com `intervalDays`. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  intervalMonths?: number;

  /** O roteiro que o técnico preenche na visita deste tipo. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  checklistTemplateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

/**
 * Os três campos abaixo saem da base e voltam declarados aqui.
 *
 * Não é repetição por gosto: uma subclasse não pode alargar `number` para
 * `number | null`, e é exatamente o `null` que dá ao cliente como dizer "este
 * campo não vale mais". `key` fica de fora porque não se edita.
 */
export class UpdateRvtMaintenanceTypeDto extends PartialType(
  OmitType(CreateRvtMaintenanceTypeDto, [
    'key',
    'intervalDays',
    'intervalMonths',
    'checklistTemplateId',
  ] as const),
) {
  /**
   * Trocar a unidade da cadência exige mandar a outra como `null`.
   *
   * Dia e mês são exclusivos. Se um `PATCH` só pudesse acrescentar, mudar de
   * trimestral para 90 dias mandaria `intervalDays` e deixaria `intervalMonths`
   * de pé — os dois preenchidos, que é justamente o que `assertCadence` recusa.
   * `null` é como o cliente diz "esta não vale mais"; ausente continua sendo
   * "não mexi".
   */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(366)
  intervalDays?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  intervalMonths?: number | null;

  /** `null` tira o roteiro do tipo; ausente mantém o que está lá. */
  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsUUIDv7()
  checklistTemplateId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
