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

/**
 * Correção dos dados de quem foi cadastrado pela organização.
 *
 * Os mesmos três campos que o owner informou em `CreateTeamMemberDto`, e nada
 * além deles: papel, situação, unidades e permissões continuam em
 * `PATCH /organizations/current/members/:userId`, que é decisão de acesso — e
 * misturar as duas num corpo só faria um erro de digitação no nome exigir a
 * autorização de reescrever permissões.
 *
 * Todos opcionais, e ao menos um exigido pelo serviço: um corpo vazio não é
 * "nenhuma mudança", é uma chamada que o cliente não quis fazer.
 */
export class UpdateTeamMemberDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lastName?: string;
}
