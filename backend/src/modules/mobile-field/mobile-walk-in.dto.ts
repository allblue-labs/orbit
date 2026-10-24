import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsDate,
  IsIn,
  IsOptional,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  AssetIdentifierType,
  OperationKind,
  OperationPriority,
} from '../../contracts';
import { IsUUIDv7 } from '../../validators';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * O endereço do atendimento, do jeito que dá para preencher na calçada.
 *
 * **Todo campo é opcional**, inclusive o CEP. O técnico está na porta: ele sabe
 * onde está, e exigir o cadastro completo para abrir a ordem significa não abrir
 * a ordem. O que falta se completa depois, no escritório.
 *
 * `reference` existe porque em campo é o que de fato localiza — "portão azul ao
 * lado da padaria" leva o próximo técnico ao lugar certo melhor que o número.
 */
export class WalkInAddressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(16)
  postalCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  street?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  complement?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  district?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4)
  stateCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  country?: string;

  /** Ponto de referência — o que localiza de fato, em campo. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  reference?: string;
}

/**
 * O cliente que ainda não existe no cadastro.
 *
 * Só `legalName` é exigido, e por uma razão simples: um cliente sem nome não é
 * um cadastro, é uma linha anônima na carteira. Documento, endereço, e-mail e
 * telefone entram se a pessoa tiver — e é por isso que existe a consulta de
 * CNPJ, que preenche quase tudo de uma vez.
 */
export class WalkInCustomerDto {
  @ApiPropertyOptional({ enum: ['COMPANY', 'INDIVIDUAL'], default: 'COMPANY' })
  @IsOptional()
  @IsIn(['COMPANY', 'INDIVIDUAL'])
  type?: 'COMPANY' | 'INDIVIDUAL';

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

  /** CNPJ ou CPF, como a pessoa digitou. O servidor guarda só os dígitos. */
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

  /** Quem atende no local. Vira o contato principal do cliente. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  contactName?: string;

  @ApiPropertyOptional({ type: () => WalkInAddressDto })
  @IsOptional()
  @Type(() => WalkInAddressDto)
  @ValidateNested()
  address?: WalkInAddressDto;
}

/**
 * Um equipamento identificado na hora.
 *
 * Só o nome é exigido — "Split do quarto" já identifica o aparelho para quem
 * está no local. Marca, modelo e número de série são placas que às vezes estão
 * atrás da unidade condensadora, no telhado, e exigi-las é exigir que o técnico
 * suba antes de abrir a ordem.
 */
export class WalkInEquipmentDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(180)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  category?: string;

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

  /** Onde o aparelho está dentro do endereço: "sala 2", "recepção". */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  location?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  identifier?: string;

  @ApiPropertyOptional({ enum: Object.values(AssetIdentifierType) })
  @IsOptional()
  @IsIn(Object.values(AssetIdentifierType))
  identifierType?: AssetIdentifierType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  installationAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  warrantyUntil?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  specifications?: Record<string, unknown>;
}

/**
 * Abrir um atendimento na hora, em campo.
 *
 * ## Por que uma chamada só
 *
 * Porque são três cadastros que só fazem sentido juntos — cliente, equipamentos
 * e ordem — e o técnico está na porta. Em três chamadas, a queda da rede entre
 * a segunda e a terceira deixaria um cliente cadastrado sem atendimento e o
 * técnico sem saber o que já foi feito.
 *
 * ## Cliente existente **ou** novo, nunca os dois
 *
 * `customerId` escolhe quem já está na carteira; `customer` cadastra na hora.
 * Aceitar os dois obrigaria o servidor a decidir qual vale, e qualquer escolha
 * seria arbitrária.
 */
export class CreateWalkInOperationDto {
  /** Omitida, a unidade principal do ator. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @ApiPropertyOptional({ type: () => WalkInCustomerDto })
  @IsOptional()
  @Type(() => WalkInCustomerDto)
  @ValidateNested()
  customer?: WalkInCustomerDto;

  /** Equipamentos já cadastrados daquele cliente. */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUIDv7({ each: true })
  assetIds?: string[];

  /** Equipamentos identificados na hora. Um ou vários. */
  @ApiPropertyOptional({ type: () => [WalkInEquipmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => WalkInEquipmentDto)
  @ValidateNested({ each: true })
  equipment?: WalkInEquipmentDto[];

  /** Omitida, `MAINTENANCE`: atendimento avulso é quase sempre manutenção. */
  @ApiPropertyOptional({ enum: Object.values(OperationKind) })
  @IsOptional()
  @IsIn(Object.values(OperationKind))
  kind?: OperationKind;

  /** Omitido, o servidor compõe a partir do nome do cliente. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(220)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(OperationPriority) })
  @IsOptional()
  @IsIn(Object.values(OperationPriority))
  priority?: OperationPriority;

  /** O ponto dentro do endereço. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  sector?: string;
}
