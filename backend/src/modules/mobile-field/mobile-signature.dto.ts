import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Matches,
  MinLength,
  Min,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class MobileSignatureUploadDto {
  @ApiProperty({
    description: 'StorageFile AVAILABLE criado pelo fluxo seguro de upload.',
  })
  @IsUUIDv7()
  storageObjectId!: string;
}

/** Grant opaco e curto para ler somente a assinatura do ator autenticado. */
export class MobileSignaturePreviewQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(4_102_444_800)
  expires!: number;

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  signature!: string;
}

/** Para que serve o arquivo reservado. É o que a trilha de auditoria registra. */
export const SIGNATURE_UPLOAD_PURPOSES = [
  'PROFESSIONAL_SIGNATURE',
  'CUSTOMER_ACKNOWLEDGEMENT',
] as const;

export class MobileSignatureUploadReservationDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  fileName!: string;

  @ApiProperty({ enum: ['image/png', 'image/jpeg', 'image/webp'] })
  @IsIn(['image/png', 'image/jpeg', 'image/webp'])
  mimeType!: 'image/png' | 'image/jpeg' | 'image/webp';

  @ApiProperty({ maximum: 2_000_000 })
  @IsInt()
  @Min(1)
  @Max(2_000_000)
  sizeBytes!: number;

  /**
   * O destino do arquivo. Opcional; ausente vale como assinatura profissional,
   * que é o que a rota fazia antes de o aceite do cliente também reservar por
   * aqui.
   *
   * Não decide autorização nem validação — as duas são idênticas. Decide o que
   * a metadata do objeto vai dizer, e registrar a assinatura de um cliente como
   * "assinatura profissional" seria uma linha falsa na trilha.
   */
  @ApiPropertyOptional({ enum: SIGNATURE_UPLOAD_PURPOSES })
  @IsOptional()
  @IsIn(SIGNATURE_UPLOAD_PURPOSES)
  purpose?: (typeof SIGNATURE_UPLOAD_PURPOSES)[number];
}

export class CustomerAcknowledgementInputDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  signerName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  signatureStorageFileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  contactId?: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  expectedVersion!: string;

  @ApiProperty()
  @IsString()
  @MinLength(64)
  @MaxLength(64)
  contentHash!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(120)
  commandId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  occurredAt?: Date;
}
