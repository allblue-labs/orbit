import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerifiedPlatformAuthority } from '../../common/verified-platform-authority';
import { RequestContext, RequestContextStorage } from '../../context';
import { RlsTransaction } from '../../database';
import { PUBLIC_KEY } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  TENANT_RECOVERY,
  TENANT_STATUS_CHANGE,
  TenantOperationPolicy,
} from './tenant-operation.policy';

@Injectable()
export class TenantOperationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly storage: RequestContextStorage,
    private readonly policy: TenantOperationPolicy,
    private readonly rls: RlsTransaction,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    // Public capability writes and portal actors have their own authenticated boundary.
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets))
      return true;
    const request = context
      .switchToHttp()
      .getRequest<IdentityRequest & { id?: string }>();
    const identity = request.identity;
    if (!identity) return true; // Private requests have already crossed JWT authentication.
    request.id ??=
      request.header('x-request-id')?.slice(0, 120) || generateUuidV7();
    return this.storage.run(
      new RequestContext({
        requestId: request.id,
        actorType: 'INTERNAL_USER',
        userId: identity.id,
        organizationId: identity.organizationId,
        businessUnitId: identity.businessUnitId,
        businessUnitIds: identity.businessUnitIds,
        roles: identity.roles,
        permissions: identity.permissions,
        platformAuthority: identity.platformAuthority,
        isOrganizationOwner: identity.isOrganizationOwner,
        allowedSurfaces: identity.allowedSurfaces,
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      async () => {
        if (
          this.reflector.getAllAndOverride<boolean>(
            TENANT_STATUS_CHANGE,
            targets,
          )
        ) {
          const authority = VerifiedPlatformAuthority.forUser(
            identity.platformAuthority,
            identity.id,
          );
          if (
            !VerifiedPlatformAuthority.hasRole(
              authority,
              identity.id,
              'PLATFORM_ADMIN',
            ) ||
            !(
              authority?.permissions.includes('*') ||
              authority?.permissions.includes('platform.admin')
            )
          ) {
            const target = request.params.id;
            await this.rls.run((tx) =>
              tx.auditLog.create({
                data: {
                  organizationId: identity.organizationId,
                  userId: identity.id,
                  action: 'TENANT_OPERATIONAL_STATUS_REJECTED',
                  entityType: 'ORGANIZATION',
                  requestId: request.id,
                  metadata: {
                    result: 'REJECTED',
                    code: 'FORBIDDEN',
                    authoritySource: 'NONE',
                    requestedOrganizationId:
                      typeof target === 'string' &&
                      /^[0-9a-f-]{36}$/i.test(target)
                        ? target
                        : null,
                  },
                },
              }),
            );
            throw new ForbiddenException(
              'Verified platform authority is required',
            );
          }
        }
        // These annotations do not bypass the following surface, RBAC or financial guards.
        if (this.reflector.getAllAndOverride<string>(TENANT_RECOVERY, targets))
          return true;
        if (identity.organizationId) await this.policy.assertOperational();
        return true;
      },
    );
  }
}
