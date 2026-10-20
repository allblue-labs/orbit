import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { UUID } from '../../../contracts';
import { HashHelper } from '../../../helpers/foundation.helpers';
import type {
  AccessTokenClaims,
  AuthenticatedIdentity,
  TokenPair,
} from '../domain/identity.types';

@Injectable()
export class IdentityTokenService {
  static readonly ACCESS_TOKEN_TTL_SECONDS = 900;
  static readonly REFRESH_TOKEN_TTL_SECONDS = 2_592_000;

  constructor(private readonly jwt: JwtService) {}

  async issue(
    identity: AuthenticatedIdentity,
  ): Promise<TokenPair & { refreshTokenHash: string; expiresAt: Date }> {
    const claims: AccessTokenClaims = {
      sub: identity.id,
      sid: identity.sessionId,
      organizationId: identity.organizationId,
      businessUnitId: identity.businessUnitId,
      businessUnitIds: identity.businessUnitIds,
      roles: identity.roles,
      permissions: identity.permissions,
      allowedSurfaces: identity.allowedSurfaces,
      isOrganizationOwner: identity.isOrganizationOwner,
      type: 'access',
    };
    const refreshToken = randomBytes(48).toString('base64url');
    return {
      accessToken: await this.jwt.signAsync(claims, {
        expiresIn: IdentityTokenService.ACCESS_TOKEN_TTL_SECONDS,
      }),
      refreshToken,
      refreshTokenHash: HashHelper.sha256(refreshToken),
      expiresAt: new Date(
        Date.now() + IdentityTokenService.REFRESH_TOKEN_TTL_SECONDS * 1_000,
      ),
      tokenType: 'Bearer',
      expiresIn: IdentityTokenService.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token);
  }

  hashOpaqueToken(token: string): string {
    return HashHelper.sha256(token);
  }

  generateOpaqueToken(): string {
    return randomBytes(48).toString('base64url');
  }

  asUuid(value: string): UUID {
    return value as UUID;
  }
}
