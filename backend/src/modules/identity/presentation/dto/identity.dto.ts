import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { BusinessUnitType, InvitationStatus } from '../../../../contracts';
import {
  detectBrazilianDocumentType,
  normalizeBrazilianDocument,
} from '../../../../utils';
import { IsDocument, IsUUIDv7 } from '../../../../validators';
import { ACCEPTED_IMAGE_MIME_TYPES } from '../../../storage/image-signature';
import { AVATAR_MAX_BYTES } from '../../application/avatar.service';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class LoginDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(6, 10)
  mfaCode?: string;

  @ApiPropertyOptional({ default: 'WEB' })
  @IsOptional()
  @IsIn(['WEB', 'MOBILE', 'API'])
  client = 'WEB';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  deviceId?: string;
}

export class RegisterOrganizationDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  organizationName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  legalName!: string;

  @ApiProperty()
  @Transform(
    ({ value, obj }: { value: unknown; obj: Record<string, unknown> }) =>
      typeof obj.documentNumber === 'string'
        ? (detectBrazilianDocumentType(obj.documentNumber) ?? value)
        : value,
  )
  @IsIn(['CPF', 'CNPJ'])
  documentType!: string;

  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeBrazilianDocument(value) : value,
  )
  @IsDocument()
  @IsString()
  @MinLength(11)
  @MaxLength(18)
  documentNumber!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  city!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  street!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 2)
  stateCode!: string;

  @ApiPropertyOptional({ default: 'SERVICES' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  primarySegment = 'SERVICES';

  @ApiPropertyOptional({ default: 'STARTER' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  planKey = 'STARTER';

  @ApiPropertyOptional({ default: BusinessUnitType.HEADQUARTERS })
  @IsOptional()
  @IsIn(Object.values(BusinessUnitType))
  businessUnitType: BusinessUnitType = BusinessUnitType.HEADQUARTERS;

  @ApiPropertyOptional({ default: 'WEB' })
  @IsOptional()
  @IsIn(['WEB', 'MOBILE', 'API'])
  client = 'WEB';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  deviceId?: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

/**
 * Troca da própria senha.
 *
 * `currentPassword` é obrigatória: sem ela, uma sessão sequestrada trocaria a
 * senha e expulsaria o dono da conta. É a diferença entre este fluxo e o de
 * recuperação por e-mail, que existe para quem **não** tem a senha atual.
 *
 * O comprimento mínimo é o mesmo do cadastro e do reset — a política de senha
 * é uma só na plataforma.
 */
export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class UpdateProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class CreateInvitationDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsUUIDv7()
  roleId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;
}

export class InvitationQueryDto {
  /** Sem filtro devolve todos os estados, o que é o padrão da aba. */
  @ApiPropertyOptional({ enum: Object.values(InvitationStatus) })
  @IsOptional()
  @IsIn(Object.values(InvitationStatus))
  status?: InvitationStatus;

  /** Busca por e-mail convidado. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @MaxLength(320)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class AcceptInvitationDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class VerifyMfaDto {
  @ApiProperty()
  @IsString()
  @Length(6, 10)
  code!: string;
}

export class EnableMfaDto extends VerifyMfaDto {
  @ApiProperty()
  @IsUUIDv7()
  factorId!: string;
}

/**
 * Reserva do envio da foto de perfil.
 *
 * O tipo declarado aqui não decide nada: o servidor confere os primeiros bytes
 * do que chegou. Ele existe para recusar cedo o que já se sabe que não serve,
 * e para que a URL assinada carregue o `Content-Type` certo.
 */
export class ReserveAvatarUploadDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ enum: ACCEPTED_IMAGE_MIME_TYPES })
  @IsIn(ACCEPTED_IMAGE_MIME_TYPES)
  mimeType!: (typeof ACCEPTED_IMAGE_MIME_TYPES)[number];

  @ApiProperty({ maximum: AVATAR_MAX_BYTES })
  @IsInt()
  @Min(1)
  @Max(AVATAR_MAX_BYTES)
  sizeBytes!: number;
}

export class ActivateAvatarDto {
  @ApiProperty()
  @IsUUIDv7()
  storageObjectId!: string;
}
