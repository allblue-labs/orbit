import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { BusinessUnitType } from '../../../contracts';
import { ROLE_SURFACES } from '../team-roles';
import { IsDocument, IsUUIDv7 } from '../../../validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateBusinessUnitDto {
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

  @ApiProperty({ enum: Object.values(BusinessUnitType) })
  @IsIn(Object.values(BusinessUnitType))
  type!: BusinessUnitType;

  @ApiProperty({ example: 'CNPJ' })
  @IsIn(['CPF', 'CNPJ'])
  documentType!: string;

  @ApiProperty()
  @IsDocument()
  documentNumber!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  city!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  street!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(30)
  number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 2)
  stateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(8, 16)
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  parentId?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateBusinessUnitDto extends PartialType(CreateBusinessUnitDto) {}

/**
 * A marca que vai no cabeçalho dos documentos emitidos pela unidade.
 *
 * Rota própria, e não mais um campo do `PATCH`: o corpo tem centenas de
 * quilobytes, e misturá-lo ao update de nome e endereço faria toda edição de
 * cadastro carregar a imagem junto — inclusive quando ninguém quis trocá-la.
 *
 * Chega como data URI. O porquê — e o que isso impede — está em
 * `common/embedded-image.ts`.
 */
export class UpdateBusinessUnitLogoDto {
  @ApiProperty({
    description: 'Imagem em data URI (PNG ou JPEG).',
    example: 'data:image/png;base64,iVBORw0KGgo…',
  })
  @IsString()
  @MaxLength(1_400_000)
  image!: string;
}

/**
 * A marca da empresa.
 *
 * Mesmo contrato do logo de unidade — rota própria, data URI, e o porquê em
 * `common/embedded-image.ts`. São DTOs separados porque são recursos
 * separados: a unidade pode ter a sua, e esta é o padrão de quem não tem.
 */
export class UpdateOrganizationLogoDto {
  @ApiProperty({
    description: 'Imagem em data URI (PNG ou JPEG).',
    example: 'data:image/png;base64,iVBORw0KGgo…',
  })
  @IsString()
  @MaxLength(1_400_000)
  image!: string;
}

export class CreateOrganizationDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  displayName!: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  primarySegment!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  planKey!: string;

  @ApiProperty({ type: CreateBusinessUnitDto })
  @ValidateNested()
  @Type(() => CreateBusinessUnitDto)
  primaryBusinessUnit!: CreateBusinessUnitDto;
}

export class UpdateOrganizationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  primarySegment?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

/**
 * Situação de uma associação.
 *
 * Formaliza os valores que `OrganizationMembership.status` já usava em texto.
 * `ACTIVE` recebe trabalho; os demais não — e é o backend que decide isso em
 * cada consulta, não a tela.
 */
export const MembershipStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type MembershipStatus =
  (typeof MembershipStatus)[keyof typeof MembershipStatus];

export class MemberQueryDto {
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

/**
 * Alteração de membro.
 *
 * Só papel e situação. Nome, e-mail e avatar são do **perfil**, que cada pessoa
 * administra em `identity/me` — um gestor não edita a identidade de outro.
 */
export class UpdateMemberDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  roleId?: string;

  @ApiPropertyOptional({ enum: Object.values(MembershipStatus) })
  @IsOptional()
  @IsIn(Object.values(MembershipStatus))
  status?: MembershipStatus;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsUUIDv7({ each: true })
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

export class CreateRoleDto {
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

  /**
   * Permissões concedidas.
   *
   * O formato é o mesmo que os decoradores `@Permissions` usam
   * (`modulo.acao`). Nada é validado contra um catálogo porque não existe
   * catálogo de permissões no backend — quem não reconhece uma permissão
   * simplesmente não a concede a nada.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  permissions?: string[];

  /**
   * Onde o papel entra: `WEB`, `MOBILE`, `API`.
   *
   * Omitido, o papel nasce podendo os dois — que é o que todo papel podia
   * antes desta coluna existir. Quem cria um papel de campo declara `MOBILE`
   * e o painel web passa a recusar a entrada, com a credencial certa e tudo.
   */
  @ApiPropertyOptional({ type: [String], enum: ROLE_SURFACES })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn([...ROLE_SURFACES], { each: true })
  allowedSurfaces?: string[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
