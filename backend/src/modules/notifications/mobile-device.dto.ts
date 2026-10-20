import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  MOBILE_PLATFORMS,
  MOBILE_PUSH_PROVIDERS,
  type MobilePlatform,
  type MobilePushProvider,
} from './mobile-device.read-models';

export class RegisterMobileDeviceDto {
  @ApiProperty({ description: 'Identidade aleatória app-scoped do MB-04' })
  @IsString()
  @MinLength(16)
  @MaxLength(120)
  deviceInstanceId!: string;

  @ApiProperty({ enum: MOBILE_PLATFORMS })
  @IsIn(MOBILE_PLATFORMS)
  platform!: MobilePlatform;

  @ApiProperty({ enum: MOBILE_PUSH_PROVIDERS })
  @IsIn(MOBILE_PUSH_PROVIDERS)
  pushProvider!: MobilePushProvider;

  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  pushToken!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  appVersion!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  osVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
