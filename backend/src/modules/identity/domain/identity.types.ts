import type { UUID } from '../../../contracts';

export interface AccessTokenClaims {
  sub: UUID;
  sid: UUID;
  organizationId: UUID | null;
  businessUnitId: UUID | null;
  businessUnitIds: readonly UUID[];
  roles: readonly string[];
  permissions: readonly string[];
  allowedSurfaces: readonly string[];
  isOrganizationOwner: boolean;
  type: 'access';
}

export interface AuthenticatedIdentity {
  id: UUID;
  sessionId: UUID;
  organizationId: UUID | null;
  businessUnitId: UUID | null;
  businessUnitIds: readonly UUID[];
  roles: readonly string[];
  permissions: readonly string[];
  allowedSurfaces: readonly string[];
  isOrganizationOwner: boolean;
}

export interface SessionMetadata {
  client: string;
  deviceId?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  /**
   * A senha usada agora é provisória?
   *
   * Vai na resposta do login para que o cliente decida **antes** de montar a
   * primeira tela, sem uma segunda chamada. O perfil publica o mesmo campo, que
   * é o que vale depois — este é só o atalho do primeiro instante.
   *
   * Não é fronteira de segurança: o token emitido é completo, e quem tem a
   * senha temporária tem acesso até trocá-la. Ele existe porque o dono da
   * organização escolheu essa senha e não deve continuar sabendo a senha do
   * técnico — a troca forçada é o que encerra isso.
   */
  mustChangePassword?: boolean;
}

export const IdentityTokenPurpose = {
  INVITATION: 'INVITATION',
  PASSWORD_RESET: 'PASSWORD_RESET',
} as const;
export type IdentityTokenPurpose =
  (typeof IdentityTokenPurpose)[keyof typeof IdentityTokenPurpose];

export interface IIdentityTokenDelivery {
  deliver(
    purpose: IdentityTokenPurpose,
    recipient: string,
    token: string,
  ): Promise<void>;
}

export const IDENTITY_TOKEN_DELIVERY = Symbol('IDENTITY_TOKEN_DELIVERY');
