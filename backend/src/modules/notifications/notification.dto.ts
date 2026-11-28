import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { NotificationStatus, NotificationType } from '../../contracts';
import { IsUUIDv7 } from '../../validators';
// REALTIME is a compatibility alias for the persisted IN_APP inbox, never a socket.
const supportedChannels = ['IN_APP', 'REALTIME', 'EMAIL', 'PUSH'] as const;

export class NotificationQueryDto {
  @IsOptional()
  @IsIn(Object.values(NotificationStatus))
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  unreadOnly?: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class CreateNotificationDto {
  @IsUUIDv7()
  recipientUserId!: string;

  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @IsString()
  @MaxLength(80)
  type!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsIn(supportedChannels, { each: true })
  channels!: string[];

  @IsString()
  @MinLength(1)
  @MaxLength(180)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledAt?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

export class NotificationPreferenceDto {
  @IsString()
  @MaxLength(80)
  type!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(supportedChannels, { each: true })
  channels!: string[];

  @IsOptional()
  @IsObject()
  quietHours?: Record<string, unknown>;
}

class PushKeysDto {
  @IsString()
  @MinLength(20)
  p256dh!: string;

  @IsString()
  @MinLength(10)
  auth!: string;
}

export class RegisterPushSubscriptionDto {
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(4000)
  endpoint!: string;

  @ValidateNested()
  @Type(() => PushKeysDto)
  keys!: PushKeysDto;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

export class UnregisterPushSubscriptionDto {
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  @MaxLength(4000)
  endpoint!: string;
}

export const SupportedNotificationType = NotificationType;
