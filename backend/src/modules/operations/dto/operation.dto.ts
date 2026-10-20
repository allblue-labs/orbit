import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  OperationKind,
  OperationPriority,
  OperationStatus,
} from '../../../contracts';
import { IsUUIDv7 } from '../../../validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class OperationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(220)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  assetId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  assignedUserId?: string;

  /**
   * Só o que está atribuído e esperando autorização.
   *
   * É a fila da aba Autorização. Vem como filtro do contrato, e não como recorte de
   * página, para a contagem ser a da organização e não a dos vinte que couberam.
   */
  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' || value === true ? true : undefined,
  )
  @IsBoolean()
  pendingAuthorization?: boolean;

  @ApiPropertyOptional({ enum: Object.values(OperationKind) })
  @IsOptional()
  @IsIn(Object.values(OperationKind))
  kind?: OperationKind;

  @ApiPropertyOptional({ enum: Object.values(OperationStatus) })
  @IsOptional()
  @IsIn(Object.values(OperationStatus))
  status?: OperationStatus;

  @ApiPropertyOptional({ enum: Object.values(OperationPriority) })
  @IsOptional()
  @IsIn(Object.values(OperationPriority))
  priority?: OperationPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledFrom?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledTo?: Date;

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

export class CreateOperationDto {
  @ApiProperty()
  @IsUUIDv7()
  businessUnitId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  /**
   * Os equipamentos atendidos.
   *
   * Era `assetId`, um só. Um atendimento em campo raramente toca um
   * equipamento: o técnico vai ao endereço e atende os aparelhos que estão lá,
   * e uma ordem por aparelho multiplicava o trabalho administrativo sem
   * descrever melhor o serviço.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUIDv7({ each: true })
  assetIds?: string[];

  /** Para onde o técnico vai — um endereço cadastrado do cliente. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerAddressId?: string;

  /** O ponto exato dentro do endereço. Opcional: nem todo lugar tem setor. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  sector?: string;

  /**
   * O técnico em campo pode ver quanto este atendimento vale?
   *
   * `false` por omissão, e a omissão é deliberada: o valor combinado com o cliente
   * não é informação que todo técnico precise ter na mão dentro da casa dele. Ligar
   * é um ato consciente, por atendimento.
   *
   * O número não vem daqui: é o total do orçamento vinculado. Este campo governa a
   * visibilidade, e sem orçamento não há o que mostrar mesmo ligado.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  amountVisibleInField?: boolean;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  code!: string;

  @ApiProperty({ enum: Object.values(OperationKind) })
  @IsIn(Object.values(OperationKind))
  kind!: OperationKind;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(220)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: Object.values(OperationPriority) })
  @IsOptional()
  @IsIn(Object.values(OperationPriority))
  priority?: OperationPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledStart?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledEnd?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  location?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  responsibleFieldTechnicianId?: string;

  @ApiPropertyOptional({ type: [String], description: 'auxiliares técnico' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUIDv7({ each: true })
  auxiliaryTechnicianIds?: string[];
}

export class UpdateOperationDto extends PartialType(CreateOperationDto) {}

/**
 * Autorizar várias atribuições de uma vez.
 *
 * ## Por que ids, e não "todas do técnico X"
 *
 * Porque o dono autoriza o que ele **viu**. Um comando que dissesse "todas do
 * Eduardo" resolveria o conjunto no servidor, no instante da chamada — e uma
 * operação criada entre a tela carregar e o botão ser clicado entraria na
 * autorização sem ninguém ter olhado para ela. Autorização é liberação de trabalho
 * para o campo; o conjunto precisa ser o da tela.
 *
 * Quem decide o agrupamento é o cliente: todas de um técnico, todas de um dia, ou
 * uma só. Para o servidor é a mesma operação em lote.
 */
export class AuthorizeOperationsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsUUIDv7({ each: true })
  operationIds!: string[];
}

export class ChangeOperationStatusDto {
  @ApiProperty({ enum: Object.values(OperationStatus) })
  @IsIn(Object.values(OperationStatus))
  status!: OperationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AssignOperationUserDto {
  @ApiProperty()
  @IsUUIDv7()
  userId!: string;
}

export class ReplaceResponsibleFieldTechnicianDto {
  @ApiProperty()
  @IsUUIDv7()
  userId!: string;
}

export class AddAuxiliaryTechnicianDto extends ReplaceResponsibleFieldTechnicianDto {}
