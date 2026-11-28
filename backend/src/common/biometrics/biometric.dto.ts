import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';
import { DEVICE_CHALLENGE_PATTERN } from './device-proof';
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

class DeviceBiometricProofDto {
  @ApiProperty()
  @IsUUID()
  challengeId!: string;

  @ApiProperty()
  @Matches(DEVICE_CHALLENGE_PATTERN)
  challenge!: string;

  @ApiProperty()
  @Matches(/^[A-Za-z0-9_-]{11,96}$/)
  signature!: string;
}

export class EnrollDeviceBiometricDto extends DeviceBiometricProofDto {
  @ApiProperty()
  @Matches(/^[A-Za-z0-9_-]{87}$/)
  publicKey!: string;

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

export class DeviceBiometricOptionsDto {
  @ApiProperty()
  @IsUUIDv7()
  credentialId!: string;
}

export class DeviceBiometricLoginDto extends DeviceBiometricProofDto {
  @ApiProperty()
  @IsUUIDv7()
  credentialId!: string;
}
