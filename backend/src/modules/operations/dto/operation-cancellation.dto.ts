import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

/**
 * O pedido feito em campo.
 *
 * `reason` tem mínimo de verdade — dez caracteres —, e não `@IsNotEmpty()`. "x" passa
 * em não-vazio e não diz nada ao dono, que é quem precisa decidir a partir dela.
 */
export class RequestOperationCancellationDto {
  @ApiProperty({
    example: 'Ninguém no local às 09h; portaria sem autorização.',
  })
  @IsString()
  @Length(10, 2000)
  reason!: string;

  /**
   * As fotos que o pedido apresenta, pelo id **local** da captura.
   *
   * ## Por que o id local, e não o da evidência
   *
   * Porque no instante do pedido a foto quase nunca existe no servidor. A captura é
   * offline-first: o arquivo entra numa fila no aparelho e sobe quando dá, de modo
   * que o `evidenceId` só nasce minutos — ou horas — depois. Pedir o id do servidor
   * aqui faria a citação funcionar só com rede boa, que é exatamente a situação em
   * que ela menos importa.
   *
   * `localMediaId` é estável desde a captura e já viaja até a linha de evidência. O
   * servidor carimba o que já chegou e carimba o resto quando chegar.
   *
   * Opcional de propósito: chuva, pressa e bateria fazem a foto faltar com
   * frequência legítima, e exigi-la transformaria uma recusa justa em impossível de
   * registrar. O teto existe para que um aplicativo em laço não cite a galeria
   * inteira.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @Length(1, 160, { each: true })
  evidenceLocalIds?: string[];
}

export const OPERATION_CANCELLATION_RESOLUTIONS = [
  'CANCELLED',
  'RESCHEDULED',
  'REASSIGNED',
  'DISMISSED',
] as const;

/**
 * O desfecho que o dono escolheu.
 *
 * Só o desfecho: reagendar e reatribuir **acontecem** pelas rotas de operação que já
 * existem, com o histórico e as validações delas. Aceitar aqui uma data nova ou um
 * técnico novo criaria um segundo caminho para alterar atendimento.
 */
export class ResolveOperationCancellationDto {
  @ApiProperty({ enum: OPERATION_CANCELLATION_RESOLUTIONS })
  @IsIn(OPERATION_CANCELLATION_RESOLUTIONS)
  resolution!: (typeof OPERATION_CANCELLATION_RESOLUTIONS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;
}
