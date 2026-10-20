import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UUID } from '../../../contracts';
import { PUBLIC_KEY } from '../../../decorators';
import { UnauthorizedException } from '../../../exceptions';
import {
  classifyInternalError,
  internalErrorStack,
  isJwtValidationError,
} from '../../../errors';
import type { AuthenticatedIdentity } from '../domain/identity.types';
import { redactSensitivePath } from '../../../common/redact-sensitive-path';
import { IdentityRepository } from './identity.repository';
import { IdentityTokenService } from '../application/token.service';
import { toAuthenticatedIdentity } from '../application/authentication.service';
import { allowsSurface } from '../domain/surface-access';

export interface IdentityRequest extends Request {
  actorType?: 'INTERNAL_USER';
  identity?: AuthenticatedIdentity;
  user?: {
    id: UUID;
    roles: readonly string[];
    permissions: readonly string[];
    businessUnitIds: readonly UUID[];
    allowedSurfaces: readonly string[];
    isOrganizationOwner: boolean;
  };
  organizationId?: UUID;
  businessUnitId?: UUID;
  businessUnitIds?: readonly UUID[];
}

@Injectable()
export class JwtAuthenticationGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthenticationGuard.name);
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: IdentityTokenService,
    private readonly repository: IdentityRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();
    let claims: Awaited<ReturnType<IdentityTokenService['verifyAccessToken']>>;
    try {
      claims = await this.tokens.verifyAccessToken(header.slice(7));
    } catch (error) {
      if (isJwtValidationError(error)) {
        throw new UnauthorizedException('Invalid or expired access token');
      }
      this.logInternalFailure(request, error);
      throw error;
    }
    try {
      const session = await this.repository.findSessionById(claims.sid);
      if (
        !session ||
        session.userId !== claims.sub ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        throw new UnauthorizedException();
      }
      if (
        claims.roles.includes('PLATFORM_ADMIN') &&
        !(await this.repository.hasActivePlatformRole(
          claims.sub,
          'PLATFORM_ADMIN',
        ))
      ) {
        await this.repository.revokeSession(session.id);
        throw new UnauthorizedException('Platform access was revoked');
      }
      const user = await this.repository.findById(claims.sub);
      if (!user || user.deletedAt || user.status !== 'ACTIVE') {
        await this.repository.revokeSession(session.id);
        throw new UnauthorizedException();
      }
      // RBAC, scope and ownership are resolved from current server state on
      // every request. A still-signed token cannot preserve revoked access.
      const identity = toAuthenticatedIdentity(user, claims.sid);
      if (!allowsSurface(user, session.client)) {
        await this.repository.revokeSession(session.id);
        throw new UnauthorizedException('Client surface access was revoked');
      }
      request.identity = identity;
      request.actorType = 'INTERNAL_USER';
      request.user = {
        id: identity.id,
        roles: identity.roles,
        permissions: identity.permissions,
        businessUnitIds: identity.businessUnitIds,
        allowedSurfaces: identity.allowedSurfaces,
        isOrganizationOwner: identity.isOrganizationOwner,
      };
      request.organizationId = identity.organizationId ?? undefined;
      request.businessUnitId = identity.businessUnitId ?? undefined;
      request.businessUnitIds = identity.businessUnitIds;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logInternalFailure(request, error);
      throw error;
    }
  }

  private logInternalFailure(request: IdentityRequest, error: unknown): void {
    const classified = classifyInternalError(error);
    const requestId = (request as { id?: unknown }).id;
    const record = JSON.stringify({
      stage: 'guard-internal-error',
      guard: JwtAuthenticationGuard.name,
      method: request.method,
      path: redactSensitivePath(request.path),
      requestId: typeof requestId === 'string' ? requestId : null,
      actorId: request.identity?.id ?? null,
      organizationId: request.identity?.organizationId ?? null,
      errorCategory: classified.category,
      exceptionClass: classified.exceptionClass,
      errorCode: classified.code,
    });
    if (process.env.NODE_ENV === 'production') {
      this.logger.error(record);
    } else {
      this.logger.error(record, internalErrorStack(error));
    }
  }
}
