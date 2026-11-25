import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from './webauthn-ceremony';

/** A resposta do navegador ao cadastro de uma passkey. */
export class WebAuthnRegistrationDto {
  @ApiProperty()
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ type: Object })
  @IsObject()
  response!: RegistrationResponseJSON;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

/** A resposta do navegador ao desafio de entrada. */
export class WebAuthnAuthenticationDto {
  @ApiProperty()
  @IsUUID()
  challengeId!: string;

  @ApiProperty({ type: Object })
  @IsObject()
  response!: AuthenticationResponseJSON;

  @ApiPropertyOptional({ default: 'WEB' })
  @IsOptional()
  @IsIn(['WEB', 'MOBILE', 'API'])
  client = 'WEB';
}

/** O app pede uma credencial para este aparelho. */
export class EnrollDeviceBiometricDto {
  @ApiProperty()
  @IsString()
  @Length(8, 120)
  deviceId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}

/** O app entra com o segredo que a biometria liberou. */
export class DeviceBiometricLoginDto {
  @ApiProperty()
  @IsUUIDv7()
  credentialId!: string;

  @ApiProperty()
  @IsString()
  @Length(32, 128)
  secret!: string;

  @ApiPropertyOptional({ default: 'MOBILE' })
  @IsOptional()
  @IsIn(['WEB', 'MOBILE', 'API'])
  client = 'MOBILE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  deviceId?: string;
}
