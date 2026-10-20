import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * O que se informa para emitir um recibo.
 *
 * ## O recorte
 *
 * São os campos que o modelo premium imprime — pagador, documento, data, valor,
 * referente e forma de pagamento — e nada além. O número não entra: é do servidor.
 * O template não entra: é o oficial de recibo da organização, e deixar a tela
 * escolher permitiria emitir um recibo com o modelo de PMOC.
 *
 * ## Do zero ou de um serviço executado
 *
 * `operationId` é a origem: quando vem, o recibo nasce amarrado àquele atendimento
 * — o documento cita o serviço, e o Financeiro sabe de onde a receita veio. Quando
 * não vem, é recibo avulso, que também existe: adiantamento, acerto, venda de peça
 * no balcão.
 *
 * Os dois caminhos preenchem os mesmos campos. A origem decide o que já vem
 * preenchido, não o que o documento é.
 */
export class CreateReceiptDto {
  @ApiPropertyOptional({
    description: 'Atendimento que originou o recibo, quando houver.',
  })
  @IsOptional()
  @IsUUID()
  operationId?: string;

  @ApiPropertyOptional({ description: 'Cliente pagador, quando cadastrado.' })
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ApiPropertyOptional({
    description: 'Unidade emissora. Sem ela, a unidade do contexto da sessão.',
  })
  @IsOptional()
  @IsUUID()
  businessUnitId?: string;

  @ApiProperty({ description: 'De quem se recebeu, como sai impresso.' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  payer!: string;

  @ApiPropertyOptional({ description: 'CNPJ ou CPF de quem pagou.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  payerDocument?: string;

  /**
   * Texto, e não número.
   *
   * O valor vai para um campo decimal do documento e para o lançamento de receita.
   * `number` em JSON é ponto flutuante: `0.1 + 0.2` não é `0.3`, e um centavo
   * perdido num recibo é um recibo contestável. O padrão aceita `1234.56`.
   */
  @ApiProperty({ example: '1234.56' })
  @Transform(trim)
  @IsString()
  @Matches(/^\d{1,13}(\.\d{1,2})?$/, {
    message: 'amount must be a decimal with up to two places',
  })
  amount!: string;

  @ApiProperty({ description: 'Data do recebimento.', format: 'date' })
  @IsDateString()
  paidOn!: string;

  @ApiProperty({ description: 'A que o pagamento se refere.' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  referring!: string;

  @ApiPropertyOptional({ description: 'Dinheiro, Pix, cartão, transferência…' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  paymentMethod?: string;
}
