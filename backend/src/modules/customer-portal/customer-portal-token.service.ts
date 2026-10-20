import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes } from 'node:crypto';
import type { UUID } from '../../contracts';
import { HashHelper } from '../../helpers/foundation.helpers';
import { EnvironmentProvider } from '../../providers';
import type {
  CustomerPortalActor,
  CustomerPortalClaims,
} from './customer-portal.types';

export interface CustomerPortalTokenPair {
  accessToken: string;
  refreshToken: string;
  refreshTokenHash: string;
  expiresAt: Date;
  tokenType: 'Bearer';
  expiresIn: number;
}

@Injectable()
export class CustomerPortalTokenService {
  static readonly ACCESS_TOKEN_TTL_SECONDS = 900;
  static readonly REFRESH_TOKEN_TTL_SECONDS = 2_592_000;

  private readonly secret: string;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(
    private readonly jwt: JwtService,
    environment: EnvironmentProvider,
  ) {
    const rootSecret =
      process.env.NODE_ENV === 'test'
        ? (environment.getOptional('JWT_ACCESS_SECRET') ??
          'test-only-jwt-secret-at-least-32-bytes')
        : environment.get('JWT_ACCESS_SECRET');
    this.secret = createHmac('sha256', rootSecret)
      .update('orbit/customer-portal/access/v1')
      .digest('base64url');
    this.issuer = `${environment.getOptional('JWT_ISSUER') ?? 'orbit-api'}:customer-portal`;
    this.audience = `${environment.getOptional('JWT_AUDIENCE') ?? 'orbit'}:customer-portal`;
  }

  async issue(actor: CustomerPortalActor): Promise<CustomerPortalTokenPair> {
    const claims: CustomerPortalClaims = {
      sub: actor.identityId,
      sid: actor.sessionId,
      actorType: 'CUSTOMER_PORTAL',
      organizationId: actor.organizationId,
      customerId: actor.customerId,
      type: 'portal_access',
    };
    const refreshToken = this.generateOpaqueToken();
    return {
      accessToken: await this.jwt.signAsync(claims, {
        secret: this.secret,
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: CustomerPortalTokenService.ACCESS_TOKEN_TTL_SECONDS,
      }),
      refreshToken,
      refreshTokenHash: this.hashOpaqueToken(refreshToken),
      expiresAt: new Date(
        Date.now() +
          CustomerPortalTokenService.REFRESH_TOKEN_TTL_SECONDS * 1_000,
      ),
      tokenType: 'Bearer',
      expiresIn: CustomerPortalTokenService.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  verifyAccessToken(token: string): Promise<CustomerPortalClaims> {
    return this.jwt.verifyAsync<CustomerPortalClaims>(token, {
      secret: this.secret,
      issuer: this.issuer,
      audience: this.audience,
    });
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
