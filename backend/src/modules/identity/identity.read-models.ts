import type { UserStatus } from '../../contracts';

export interface IdentitySessionReadModel {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  /**
   * A senha usada agora é provisória e precisa ser trocada.
   *
   * Vai no login para o cliente decidir a primeira tela sem uma segunda
   * chamada. `false` no refresh: renovar sessão não é o momento de descobrir
   * isso, e o perfil é quem responde depois.
   */
  mustChangePassword: boolean;
}

export interface IdentityProfileReadModel {
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
  emailVerifiedAt: string | null;
  mfaEnabled: boolean;
  /** A senha atual é provisória e precisa ser trocada antes de usar o sistema. */
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityDeviceSessionReadModel {
  id: string;
  client: string;
  deviceId: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  organizationId: string | null;
  businessUnitId: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}
