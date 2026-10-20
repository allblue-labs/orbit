import { CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IAuthenticatedUser, IRequestContext } from '../contracts';
import {
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  ROLES_KEY,
  SURFACES_KEY,
} from '../decorators';
import { ForbiddenException, UnauthorizedException } from '../exceptions';
import { AuthorizationService } from '../common/authorization.service';

interface GuardRequest {
  user?: IAuthenticatedUser;
  requestContext?: IRequestContext;
}

const getRequest = (context: ExecutionContext): GuardRequest =>
  context.switchToHttp().getRequest<GuardRequest>();

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    if (!getRequest(context).user) throw new UnauthorizedException();
    return true;
  }
}

abstract class MetadataGuard {
  constructor(protected readonly reflector: Reflector) {}

  protected required(
    context: ExecutionContext,
    key: string,
  ): readonly string[] {
    return (
      this.reflector.getAllAndOverride<readonly string[]>(key, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    );
  }
}

@Injectable()
export class PermissionGuard extends MetadataGuard implements CanActivate {
  constructor(
    reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {
    super(reflector);
  }

  canActivate(context: ExecutionContext): boolean {
    const required = this.required(context, PERMISSIONS_KEY);
    if (required.length === 0) return true;
    const actor =
      getRequest(context).requestContext ?? getRequest(context).user;
    if (!actor || !this.authorization.hasPermissions(actor, required)) {
      throw new ForbiddenException('Missing required permission');
    }
    return true;
  }
}

@Injectable()
export class RoleGuard extends MetadataGuard implements CanActivate {
  constructor(
    reflector: Reflector,
    private readonly authorization: AuthorizationService,
  ) {
    super(reflector);
  }

  canActivate(context: ExecutionContext): boolean {
    const required = this.required(context, ROLES_KEY);
    if (required.length === 0) return true;
    const actor =
      getRequest(context).requestContext ?? getRequest(context).user;
    if (!actor || !this.authorization.hasAnyRole(actor, required)) {
      throw new ForbiddenException('Missing required role');
    }
    return true;
  }
}

@Injectable()
export class SurfaceGuard extends MetadataGuard implements CanActivate {
  constructor(reflector: Reflector) {
    super(reflector);
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const declared = this.required(context, SURFACES_KEY);
    // Authenticated product APIs are Web/API by default. Mobile access is an
    // explicit capability of the small shared/mobile surface, never a
    // consequence of knowing a URL or carrying a valid MOBILE session.
    const required = declared.length > 0 ? declared : ['WEB', 'API'];
    const actor =
      getRequest(context).requestContext ?? getRequest(context).user;
    if (
      !actor ||
      !required.some((surface) => actor.allowedSurfaces.includes(surface))
    ) {
      throw new ForbiddenException('Client surface is not allowed');
    }
    return true;
  }
}

@Injectable()
export class OrganizationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!getRequest(context).requestContext?.organizationId) {
      throw new ForbiddenException('Organization context is required');
    }
    return true;
  }
}

@Injectable()
export class BusinessUnitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!getRequest(context).requestContext?.businessUnitId) {
      throw new ForbiddenException('Business unit context is required');
    }
    return true;
  }
}
