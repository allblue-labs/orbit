import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Nível declarado de uma especialidade.
 *
 * **Declarado, não calculado**: quem define é a organização, e nenhum critério
 * é inferido de volume de trabalho ou tempo de casa.
 */
export const SpecialtyLevel = {
  JUNIOR: 'JUNIOR',
  PLENO: 'PLENO',
  SENIOR: 'SENIOR',
  ESPECIALISTA: 'ESPECIALISTA',
} as const;
export type SpecialtyLevel =
  (typeof SpecialtyLevel)[keyof typeof SpecialtyLevel];

export const LocationSource = {
  MOBILE: 'MOBILE',
  WEB: 'WEB',
  MANUAL: 'MANUAL',
} as const;
export type LocationSource =
  (typeof LocationSource)[keyof typeof LocationSource];

export const ProfessionalRole = {
  FIELD_TECHNICIAN: 'FIELD_TECHNICIAN',
  TECHNICAL_RESPONSIBLE: 'TECHNICAL_RESPONSIBLE',
} as const;
export type ProfessionalRole =
  (typeof ProfessionalRole)[keyof typeof ProfessionalRole];

export const ProfessionalCredentialType = {
  CREA: 'CREA',
  CFT: 'CFT',
  CRT: 'CRT',
  OTHER: 'OTHER',
} as const;

export class UpdateProfessionalProfileDto {
  @ApiProperty() @IsBoolean() fieldTechnicianEnabled!: boolean;
  @ApiProperty() @IsBoolean() technicalResponsibleEnabled!: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() active =
    true;
}

export class ProfessionalSelectorQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUIDv7() businessUnitId?: string;
}

export class CreateProfessionalCredentialDto {
  @ApiProperty({ enum: Object.values(ProfessionalCredentialType) })
  @IsIn(Object.values(ProfessionalCredentialType))
  type!: keyof typeof ProfessionalCredentialType;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  registrationNumber!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  region?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  issuingAuthority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  displayLabel?: string;
}

export class RegisterProfessionalSignatureDto {
  @ApiProperty() @IsUUIDv7() storageObjectId!: string;
}

export class ProfessionalEligibilityQueryDto extends ProfessionalSelectorQueryDto {
  @ApiProperty({
    enum: ['SERVICE_ORDER', 'RVT', 'PMOC', 'TECHNICAL_REPORT', 'RECEIPT'],
  })
  @IsIn(['SERVICE_ORDER', 'RVT', 'PMOC', 'TECHNICAL_REPORT', 'RECEIPT'])
  documentType!: string;

  @ApiProperty({ enum: ['FIELD_TECHNICIAN', 'TECHNICAL_RESPONSIBLE'] })
  @IsIn(['FIELD_TECHNICIAN', 'TECHNICAL_RESPONSIBLE'])
  signedAs!: ProfessionalRole;
}

/* ------------------------------------------------------------------ */
/* Especialidades                                                      */
/* ------------------------------------------------------------------ */

export class CreateSpecialtyDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;
}

export class UpdateSpecialtyDto extends PartialType(CreateSpecialtyDto) {}

export class AssignSpecialtyDto {
  @ApiProperty()
  @IsUUIDv7()
  specialtyId!: string;

  @ApiPropertyOptional({ enum: Object.values(SpecialtyLevel) })
  @IsOptional()
  @IsIn(Object.values(SpecialtyLevel))
  level?: SpecialtyLevel;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

/* ------------------------------------------------------------------ */
/* Certificações                                                       */
/* ------------------------------------------------------------------ */

export class CreateCertificationDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  issuer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  credentialId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  issuedAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  /** Arquivo já enviado ao Storage Provider (PR-19). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  fileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateCertificationDto extends PartialType(
  CreateCertificationDto,
) {}

export class CertificationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  userId?: string;

  /** Só as que vencem dentro de N dias — recorte do servidor. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  expiringWithinDays?: number;
}

/* ------------------------------------------------------------------ */
/* Equipes                                                             */
/* ------------------------------------------------------------------ */

export class CreateTeamDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(140)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  leaderUserId?: string;
}

export class UpdateTeamDto extends PartialType(CreateTeamDto) {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}

export class AddTeamMemberDto {
  @ApiProperty()
  @IsUUIDv7()
  userId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(80)
  role?: string;
}

/* ------------------------------------------------------------------ */
/* Geolocalização                                                      */
/* ------------------------------------------------------------------ */

/**
 * Posição reportada pela própria pessoa.
 *
 * Não há `userId`: quem reporta é quem está autenticado. Publicar a posição de
 * outro seria vigilância por procuração, e o contrato não a permite.
 */
export class ReportLocationDto {
  @ApiProperty()
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @ApiPropertyOptional({ description: 'Raio de incerteza, em metros.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  accuracy?: number;

  @ApiPropertyOptional({ enum: Object.values(LocationSource) })
  @IsOptional()
  @IsIn(Object.values(LocationSource))
  source?: LocationSource;

  /** Quando o dispositivo mediu; ausente, o servidor usa a hora do recebimento. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  recordedAt?: Date;
}

export class LocationQueryDto {
  /**
   * Idade máxima da posição, em minutos.
   *
   * Uma coordenada de ontem não responde "onde a equipe está agora"; o recorte
   * é do servidor para que a tela não precise decidir o que é recente.
   */
  @ApiPropertyOptional({ default: 240 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10080)
  withinMinutes = 240;
}
