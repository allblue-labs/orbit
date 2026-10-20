import { Injectable } from '@nestjs/common';
import type { UserStatus } from '../../contracts';
import type { TokenPair } from './domain/identity.types';
import type {
  IdentityDeviceSessionReadModel,
  IdentityProfileReadModel,
  IdentitySessionReadModel,
} from './identity.read-models';

type DateValue = Date | string;
type NullableDateValue = DateValue | null;

interface ProfileSource {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  locale: string | null;
  timezone: string | null;
  status: UserStatus;
  emailVerifiedAt: NullableDateValue;
  createdAt: DateValue;
  updatedAt: DateValue;
  mfaEnabled?: boolean;
  mfaFactors?: readonly unknown[];
  mustChangePassword?: boolean;
}

interface DeviceSessionSource {
  id: string;
  client: string;
  deviceId: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  organizationId: string | null;
  businessUnitId: string | null;
  expiresAt: DateValue;
  revokedAt: NullableDateValue;
  createdAt: DateValue;
}

@Injectable()
export class IdentityReadModelMapper {
  session(source: TokenPair): IdentitySessionReadModel {
    return {
      accessToken: source.accessToken,
      refreshToken: source.refreshToken,
      tokenType: source.tokenType,
      expiresIn: source.expiresIn,
      mustChangePassword: source.mustChangePassword ?? false,
    };
  }

  profile(source: ProfileSource): IdentityProfileReadModel {
    return {
      id: source.id,
      email: source.email,
      firstName: source.firstName,
      lastName: source.lastName,
      displayName: source.displayName,
      phone: source.phone,
      avatarUrl: source.avatarUrl,
      locale: source.locale,
      timezone: source.timezone,
      status: source.status,
      emailVerifiedAt: this.nullableDate(source.emailVerifiedAt),
      mfaEnabled: source.mfaEnabled ?? Boolean(source.mfaFactors?.length),
      mustChangePassword: source.mustChangePassword ?? false,
      createdAt: this.date(source.createdAt),
      updatedAt: this.date(source.updatedAt),
    };
  }

  deviceSession(source: DeviceSessionSource): IdentityDeviceSessionReadModel {
    return {
      id: source.id,
      client: source.client,
      deviceId: source.deviceId,
      userAgent: source.userAgent,
      ipAddress: source.ipAddress,
      organizationId: source.organizationId,
      businessUnitId: source.businessUnitId,
      expiresAt: this.date(source.expiresAt),
      revokedAt: this.nullableDate(source.revokedAt),
      createdAt: this.date(source.createdAt),
    };
  }

  private date(value: DateValue): string {
    return value instanceof Date ? value.toISOString() : value;
  }

  private nullableDate(value: NullableDateValue): string | null {
    return value === null ? null : this.date(value);
  }
}
