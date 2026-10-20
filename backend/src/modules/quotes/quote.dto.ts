import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { QuoteStatus } from '../../contracts';
import { IsUUIDv7 } from '../../validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/* -------------------------------------------------------------------- */
/* Orçamento                                                             */
/* -------------------------------------------------------------------- */

/**
 * Criação.
 *
 * **Não aceita `status`, `number`, `code`, `subtotal`, `discount` de item,
 * `total` nem itens.** O orçamento nasce em `DRAFT`, vazio, com numeração do
 * servidor. Um total enviado pela rede é um total que alguém pode escolher;
 * e itens no mesmo payload da criação tornariam impossível dizer o que falhou
 * quando um deles fosse inválido.
 */
export class CreateQuoteDto {
  @ApiProperty()
  @IsUUIDv7()
  customerId!: string;

  /** Unidade dona da proposta; a da sessão quando ausente. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(220)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  notes?: string;

  /**
   * Parágrafo de abertura.
   *
   * Ausente imprime o padrão do documento. String vazia **não** é o mesmo que
   * ausente: quem apaga o texto está dizendo que não quer abertura nenhuma.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  introText?: string;

  /** Endereço de execução, entre os cadastrados do cliente. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  serviceAddressId?: string;

  /** Quem assina. A sessão quando ausente. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  responsibleUserId?: string;

  /**
   * Equipamentos cobertos.
   *
   * Lista inteira, não incremental: o conjunto é pequeno e substituí-lo de uma
   * vez evita a rota de "remover um equipamento", que só existiria para
   * desfazer um clique.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUIDv7({ each: true })
  assetIds?: string[];

  /** Último dia em que a proposta vale. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntil?: Date;

  @ApiPropertyOptional({ default: 'BRL' })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Length(3, 3)
  currency?: string;
}

/**
 * Criação a partir de uma operação concluída.
 *
 * ## Por que rota separada, e não um campo de `CreateQuoteDto`
 *
 * São duas operações diferentes com a mesma aparência. Criar do zero recebe os
 * dados; copiar de um atendimento **lê** cliente, endereço, equipamentos e
 * serviços de um registro que já existe, e cada um desses pode não estar lá.
 * Um `operationId` opcional no mesmo DTO tornaria metade dos outros campos
 * condicionalmente obrigatórios — e a mensagem de recusa deixaria de dizer o
 * que fazer.
 *
 * ## Só de atendimento concluído
 *
 * Orçar a partir do que ainda está em execução copiaria um escopo que ainda vai
 * mudar. O serviço recusa qualquer outra situação.
 *
 * Tudo o que é copiado nasce **editável**: o orçamento entra em `DRAFT`, e o
 * wizard existe justamente para revisar antes de enviar.
 */
export class CreateQuoteFromOperationDto {
  @ApiProperty()
  @IsUUIDv7()
  operationId!: string;

  /** Sobrepõe o título derivado do atendimento. */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(220)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntil?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  responsibleUserId?: string;
}

/**
 * Edição de rascunho.
 *
 * Só vale enquanto o orçamento é `DRAFT` — depois de enviado, o cliente já viu
 * o documento, e mudar título, validade ou desconto por baixo dele seria
 * alterar uma proposta que já está em análise. O servidor recusa; esta classe
 * apenas não oferece o que não pode mudar.
 *
 * `customerId` não está aqui: trocar o destinatário de uma proposta é criar
 * outra proposta.
 */
export class UpdateQuoteDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(220)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  introText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  serviceAddressId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  responsibleUserId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUIDv7({ each: true })
  assetIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntil?: Date;

  /**
   * Desconto sobre o total do orçamento.
   *
   * O servidor recusa desconto maior que o subtotal — um orçamento negativo
   * viraria despesa disfarçada de receita no Financeiro.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  discount?: number;

  /**
   * Por que houve desconto.
   *
   * Não é obrigatório: um abatimento de centavos para fechar a conta não precisa
   * de justificativa. Exigi-lo faria alguém digitar "desconto" só para passar
   * pela validação — pior que o campo vazio, porque parece explicação.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  discountReason?: string;
}

/* -------------------------------------------------------------------- */
/* Itens                                                                 */
/* -------------------------------------------------------------------- */

/**
 * Inclusão de item.
 *
 * `catalogItemId` **preenche** descrição, SKU, unidade e preço a partir do
 * Catálogo — e os campos explícitos sobrepõem, porque negociar preço é o que
 * um orçamento faz. O que for gravado vira fotografia: alterar o Catálogo
 * depois não muda o item.
 *
 * Sem `catalogItemId`, `description` e `unitPrice` passam a ser obrigatórios —
 * verificado pelo serviço, que é onde a regra pode ver os dois campos juntos.
 */
export class AddQuoteItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  catalogItemId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(9_999_999)
  quantity!: number;

  @ApiPropertyOptional({ example: 350.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  unitPrice?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/** Edição de item. `catalogItemId` não muda: a origem da fotografia é fixa. */
export class UpdateQuoteItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(9_999_999)
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  unitPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(999_999_999.99)
  discount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

/* -------------------------------------------------------------------- */
/* Transições                                                            */
/* -------------------------------------------------------------------- */

/**
 * Recusa.
 *
 * O motivo é obrigatório: uma proposta perdida sem explicação é a informação
 * comercial que mais faz falta seis meses depois.
 */
export class RejectQuoteDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class CancelQuoteDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

/**
 * Conversão em operação.
 *
 * Aceita **apenas** o que o contrato de `Operation` já exige e o que um
 * orçamento não sabe: tipo de serviço e agendamento opcional. Técnico,
 * execução e checklist não são inventados aqui — o `CreateOperationDto` os
 * trata como atribuições posteriores, e adivinhá-los produziria uma ordem de
 * serviço que ninguém combinou.
 */
export class ConvertQuoteDto {
  @ApiPropertyOptional({
    enum: ['INSTALLATION', 'MAINTENANCE', 'INSPECTION', 'DELIVERY', 'OTHER'],
    default: 'MAINTENANCE',
  })
  @IsOptional()
  @IsIn(['INSTALLATION', 'MAINTENANCE', 'INSPECTION', 'DELIVERY', 'OTHER'])
  kind?: string;

  @ApiPropertyOptional({
    enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
    default: 'NORMAL',
  })
  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: string;

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
}

/* -------------------------------------------------------------------- */
/* Consulta                                                              */
/* -------------------------------------------------------------------- */

export class QuoteQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  search?: string;

  @ApiPropertyOptional({ enum: Object.values(QuoteStatus) })
  @IsOptional()
  @IsIn(Object.values(QuoteStatus))
  status?: QuoteStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  /** Criados a partir de (inclusive). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  /** Criados até (inclusive). */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  /** Validade termina até esta data — o que vence primeiro. */
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  validUntilBefore?: Date;

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
