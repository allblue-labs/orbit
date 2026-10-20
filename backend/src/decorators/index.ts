import {
  applyDecorators,
  createParamDecorator,
  SetMetadata,
  type ExecutionContext,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiQuery,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import type { IAuthenticatedUser, IRequestContext } from '../contracts';

export const ROLES_KEY = 'foundation:roles';
export const PERMISSIONS_KEY = 'foundation:permissions';
export const SURFACES_KEY = 'foundation:surfaces';
export const PUBLIC_KEY = 'foundation:public';

interface ContextRequest extends Request {
  user?: IAuthenticatedUser;
  requestContext?: IRequestContext;
}

const request = (context: ExecutionContext): ContextRequest =>
  context.switchToHttp().getRequest<ContextRequest>();

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => request(context).user,
);

export const CurrentOrganization = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    request(context).requestContext?.organizationId,
);

export const CurrentBusinessUnit = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    request(context).requestContext?.businessUnitId,
);

export const RequestContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    request(context).requestContext,
);

export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

export const Surfaces = (...surfaces: string[]) =>
  SetMetadata(SURFACES_KEY, surfaces);

export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const ApiPagination = () =>
  applyDecorators(
    ApiQuery({ name: 'page', required: false, type: Number, example: 1 }),
    ApiQuery({ name: 'limit', required: false, type: Number, example: 20 }),
  );

export const ApiCursor = () =>
  applyDecorators(
    ApiQuery({ name: 'cursor', required: false, type: String }),
    ApiQuery({ name: 'limit', required: false, type: Number, example: 20 }),
  );

export const ApiAuthenticated = () =>
  applyDecorators(
    ApiBearerAuth(),
    ApiUnauthorizedResponse({ description: 'Authentication is required' }),
  );
