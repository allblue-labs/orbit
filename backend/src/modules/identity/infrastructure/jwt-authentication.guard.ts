import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  HttpException,
  Logger,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { UUID } from '../../../contracts';
import { PERMISSIONS_KEY, PUBLIC_KEY } from '../../../decorators';
import { ForbiddenException, UnauthorizedException } from '../../../exceptions';
import { classifyInternalError, isJwtValidationError } from '../../../errors';
import type { AuthenticatedIdentity } from '../domain/identity.types';
import { redactSensitivePath } from '../../../common/redact-sensitive-path';
import { IdentityRepository } from './identity.repository';
import { IdentityTokenService } from '../application/token.service';
import {
  platformAssignment,
  toAuthenticatedIdentity,
} from '../application/authentication.service';
import { normalizeSurface, surfacesOf } from '../domain/surface-access';
import { PLATFORM_MFA_SETUP } from '../platform-mfa-setup.decorator';
import type { VerifiedPlatformAuthority } from '../../../common/verified-platform-authority';
import {
  HotpathSnapshot,
  type HotpathAccessFence,
} from '../../../common/hotpath/hotpath-snapshot';
import { HotpathRateLimit } from '../../../common/hotpath/hotpath-rate-limit';

import {
  MOBILE_MANAGEMENT,
  isMobileManagementRequest,
  mobileManagementAreas,
  type MobileManagementArea,
} from '../../../common/mobile-management';

export interface IdentityRequest extends Request {
  accessFence?: HotpathAccessFence;
  sessionClient?: string;
  mobileManagementAllowed?: boolean;
  mobileManagementAreas?: readonly MobileManagementArea[];
  actorType?: 'INTERNAL_USER';
  identity?: AuthenticatedIdentity;
  user?: {
    id: UUID;
    platformAuthority?: VerifiedPlatformAuthority;
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

interface RequestAccess {
  identity: AuthenticatedIdentity;
  surfaces: readonly string[];
  membership?: {
    role: string;
    permissions: readonly string[];
    surfaces: readonly string[];
    delegations: readonly string[];
  };
}

type ActiveSession = NonNullable<
  Awaited<ReturnType<IdentityRepository['findSessionById']>>
>;

@Injectable()
export class JwtAuthenticationGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthenticationGuard.name);
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: IdentityTokenService,
    private readonly repository: IdentityRepository,
    @Optional() private readonly hotpath?: HotpathSnapshot,
    @Optional() private readonly limits?: HotpathRateLimit,
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
      const hotpath = this.hotpath?.available ? this.hotpath : undefined;
      const fence = hotpath
        ? await hotpath.fence(claims.sid, claims.sub)
        : undefined;
      if (hotpath && !fence) throw new UnauthorizedException();
      const session = fence
        ? undefined
        : await this.activeSession(claims.sid, claims.sub);
      const client = fence?.client ?? session!.client;
      const { identity, membership, surfaces } = await this.requestAccess(
        claims,
        fence,
        session,
      );
      const surface = normalizeSurface(client);
      if (!surfaces.includes(surface)) {
        await this.repository.revokeSession(claims.sid, claims.sub);
        throw new UnauthorizedException('Client surface access was revoked');
      }
      const targets = [context.getHandler(), context.getClass()];
      if (
        identity.platformMfaRequired &&
        !identity.allowedSurfaces.includes(surface)
      ) {
        if (
          !this.reflector.getAllAndOverride<boolean>(
            PLATFORM_MFA_SETUP,
            targets,
          )
        ) {
          throw new ForbiddenException(
            'A autenticação em dois fatores é necessária para o acesso administrativo.',
          );
        }
        identity.allowedSurfaces = [...identity.allowedSurfaces, surface];
      }
      if (identity.organizationId) {
        await this.limits?.authenticated(
          identity.organizationId,
          identity.id,
          'internal',
        );
        if (
          fence?.cacheable &&
          !identity.platformAuthority?.assignmentIds.length &&
          fence.organizationId === identity.organizationId
        )
          request.accessFence = fence;
      }
      request.sessionClient = client;
      const role = membership?.role;
      if (client === 'MOBILE' && membership) {
        const tenantPermissions = membership.permissions;
        const tenantMobile =
          identity.isOrganizationOwner ||
          membership.surfaces.includes('MOBILE');
        const delegations = tenantMobile ? membership.delegations : [];
        request.mobileManagementAreas = tenantMobile
          ? mobileManagementAreas(
              identity.isOrganizationOwner,
              role,
              tenantPermissions,
              delegations,
            )
          : [];

        const areas = this.reflector.getAllAndOverride<MobileManagementArea[]>(
          MOBILE_MANAGEMENT,
          targets,
        );
        if (
          areas?.length &&
          isMobileManagementRequest(this.reflector, targets, request)
        ) {
          const required =
            this.reflector.getAllAndOverride<string[]>(
              PERMISSIONS_KEY,
              targets,
            ) ?? [];
          const delegated =
            role === 'FIELD_TECHNICIAN' &&
            areas.some((area) => area !== 'team' && delegations.includes(area));
          request.mobileManagementAllowed =
            identity.isOrganizationOwner ||
            (role === 'ADMINISTRATOR' &&
              required.every((permission) =>
                tenantPermissions.includes(permission),
              ) &&
              areas.some((area) =>
                request.mobileManagementAreas!.includes(area),
              )) ||
            delegated;
          if (delegated) {
            // These additional permissions live only on this allowlisted request.
            identity.permissions = [
              ...new Set([...identity.permissions, ...required]),
            ];
          }
        }
      }
      request.identity = identity;
      request.actorType = 'INTERNAL_USER';
      request.user = {
        id: identity.id,
        platformAuthority: identity.platformAuthority,
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
      if (error instanceof HttpException) throw error;
      this.logInternalFailure(request, error);
      throw error;
    }
  }

  private async activeSession(
    sessionId: UUID,
    userId: UUID,
  ): Promise<ActiveSession> {
    const session = await this.repository.findSessionById(sessionId, userId);
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw new UnauthorizedException();
    return session;
  }

  private async requestAccess(
    { sid, sub }: { sid: UUID; sub: UUID },
    fence?: HotpathAccessFence,
    session?: ActiveSession,
  ): Promise<RequestAccess> {
    const key = fence?.cacheable
      ? `orbit:v1:org:${fence.organizationId}:user:${sub}:access:${fence.accessVersion}`
      : null;
    if (key) {
      const cached = await this.hotpath?.read<RequestAccess>(key);
      if (
        cached?.identity?.id === sub &&
        cached.identity.organizationId === fence?.organizationId
      ) {
        cached.identity.sessionId = sid;
        delete cached.identity.platformAuthority;
        return cached;
      }
    }

    const user = await this.repository.findById(sub);
    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      await this.repository.revokeSession(sid, sub);
      throw new UnauthorizedException();
    }
    if (user.requiresEmailVerification) {
      await this.repository.revokeSession(sid, sub);
      throw new UnauthorizedException(
        'Confirme seu e-mail antes de entrar.',
        'EMAIL_VERIFICATION_REQUIRED',
      );
    }
    const assignment = platformAssignment(user);
    const verifiedSession = assignment
      ? (session ?? (await this.activeSession(sid, sub)))
      : undefined;
    const identity = toAuthenticatedIdentity(
      user,
      sid,
      verifiedSession?.platformMfaFactorId,
    );
    const membership = user.organizationMemberships.find(
      (item) => item.organizationId === identity.organizationId,
    );
    const access: RequestAccess = {
      identity,
      surfaces: [...surfacesOf(user)],
      membership: membership && {
        role: membership.role.key,
        permissions: membership.usesCustomAccess
          ? membership.customPermissions
          : membership.role.permissions,
        surfaces: membership.usesCustomAccess
          ? membership.customAllowedSurfaces
          : membership.role.allowedSurfaces,
        delegations: membership.mobileDelegations ?? [],
      },
    };
    if (
      key &&
      !assignment &&
      identity.organizationId === fence?.organizationId &&
      this.hotpath?.available
    ) {
      const current = await this.hotpath?.fence(sid, sub);
      if (
        current?.cacheable &&
        current.organizationId === fence.organizationId &&
        current.accessVersion === fence.accessVersion
      ) {
        const tenantIdentity: Partial<AuthenticatedIdentity> = { ...identity };
        delete tenantIdentity.sessionId;
        delete tenantIdentity.platformAuthority;
        await this.hotpath?.write(key, { ...access, identity: tenantIdentity });
      } else {
        fence.cacheable = false;
      }
    }
    return access;
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
    this.logger.error(record);
  }
}
