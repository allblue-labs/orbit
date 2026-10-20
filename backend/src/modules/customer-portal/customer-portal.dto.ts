import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';
import { CustomerPortalEmail } from './customer-portal-email';

const normalizedEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? CustomerPortalEmail.normalize(value) : value;

export class PortalLoginDto {
  @ApiProperty({ example: 'acme' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  organizationSlug!: string;

  @ApiProperty()
  @Transform(normalizedEmail)
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class PortalRefreshDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  refreshToken!: string;
}

export class ActivatePortalInvitationDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class RequestPortalPasswordResetDto {
  @ApiProperty({ example: 'acme' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  organizationSlug!: string;

  @ApiProperty()
  @Transform(normalizedEmail)
  @IsEmail()
  email!: string;
}

export class ConfirmPortalPasswordResetDto {
  @ApiProperty()
  @IsString()
  @MinLength(32)
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}

export class ChangePortalPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @ApiProperty()
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  newPassword!: string;
}

export class InviteCustomerPortalIdentityDto {
  @ApiProperty()
  @Transform(normalizedEmail)
  @IsEmail()
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(180)
  displayName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  contactId?: string;
}
