import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
export class QuoteAcceptanceResponseDto {
  @IsIn(['APPROVE', 'REJECT', 'REQUEST_CHANGES'], {
    message: 'Escolha aprovar, recusar ou solicitar alterações.',
  })
  decision!: 'APPROVE' | 'REJECT' | 'REQUEST_CHANGES';
  @Transform(trim)
  @IsString({ message: 'Informe o nome de quem responde à proposta.' })
  @MinLength(3, {
    message: 'Informe seu nome completo, com ao menos 3 caracteres.',
  })
  @MaxLength(180, { message: 'O nome deve ter no máximo 180 caracteres.' })
  signerName!: string;
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Informe o CPF/CNPJ como texto.' })
  @MaxLength(40, { message: 'O CPF/CNPJ deve ter no máximo 40 caracteres.' })
  signerDocument?: string;
  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'Informe um e-mail válido.' })
  @MaxLength(180, { message: 'O e-mail deve ter no máximo 180 caracteres.' })
  signerEmail?: string;
  @IsOptional()
  @Transform(trim)
  @IsString({ message: 'Descreva o motivo da sua resposta.' })
  @MaxLength(2000, { message: 'O motivo deve ter no máximo 2.000 caracteres.' })
  reason?: string;
  @IsOptional()
  @IsString({ message: 'Envie uma assinatura válida.' })
  @MaxLength(700000, {
    message: 'A assinatura ultrapassa o tamanho permitido.',
  })
  signatureBase64?: string;
  @IsOptional()
  @IsBoolean({ message: 'Confirme que leu e autoriza esta proposta.' })
  consentAccepted?: boolean;
}
