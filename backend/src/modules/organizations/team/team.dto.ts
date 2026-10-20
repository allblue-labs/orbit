import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ROLE_SURFACES } from '../team-roles';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateTeamMemberDto {
  @ApiProperty()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName!: string;

  @ApiProperty({ description: 'Papel atribuível da organização' })
  @IsUUID('7')
  roleId!: string;

  /** Omitida, a pessoa entra na unidade principal. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID('7')
  businessUnitId?: string;

  /** One or more unit scopes. Supersedes businessUnitId when present. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('7', { each: true })
  businessUnitIds?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  useRoleDefaults?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  permissions?: string[];

  @ApiPropertyOptional({ type: [String], enum: ROLE_SURFACES })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn([...ROLE_SURFACES], { each: true })
  allowedSurfaces?: string[];
}
