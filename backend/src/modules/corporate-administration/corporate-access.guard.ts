import {
  BadRequestException,
  createParamDecorator,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { TLSSocket } from 'node:tls';
import { AuthRateLimitService } from '../../common/auth-rate-limit.service';
import {
  isTrustedProxyRequest,
  normalizeClientIp,
  requestClientIp,
} from '../../common/trusted-client-origin';
import {
  correlationHeaders,
  correlationId,
} from '../../observability/correlation';
import {
  TechnicalCredentialService,
  ORGANIZATIONS_REACTIVATE,
  ORGANIZATIONS_SUSPEND,
  type CorporateCapability,
  type TechnicalPrincipal,
} from './technical-credential.service';

export const RequiresCorporateCapability = Reflector.createDecorator<
  CorporateCapability | readonly CorporateCapability[] | 'operational-status'
>();
export function operationalCapability(status: unknown) {
  if (status === 'SUSPENDED') return ORGANIZATIONS_SUSPEND;
  if (status === 'ACTIVE') return ORGANIZATIONS_REACTIVATE;
  throw new BadRequestException('Estado operacional inválido.');
}
const TECHNICAL_PRINCIPAL = Symbol('corporate-technical-principal');
const auditLogger = new Logger('CorporateAdministrationAudit');
type CorporateRequest = Request & {
  id?: string;
  [TECHNICAL_PRINCIPAL]?: TechnicalPrincipal;
};

export const CorporateCaller = createParamDecorator(
  (_: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<CorporateRequest>();
    const principal = request[TECHNICAL_PRINCIPAL];
    if (!principal) throw new UnauthorizedException();
    return { principal, correlationId: request.id ?? correlationId(request) };
  },
);

export interface CorporateCall {
  principal: TechnicalPrincipal;
  correlationId: string;
}

function audit(
  context: ExecutionContext,
  outcome: 'allowed' | 'denied',
  code: string,
) {
  const request = context.switchToHttp().getRequest<CorporateRequest>();
  auditLogger.log({
    event: 'corporate_admin_access',
    role: 'TECHNICAL',
    operation: context.getHandler().name,
    correlationId: request.id,
    technicalPrincipalId: request[TECHNICAL_PRINCIPAL]?.id,
    outcome,
    code,
  });
}

@Injectable()
export class TechnicalAuthenticationGuard implements CanActivate {
  constructor(
    private readonly credentials: TechnicalCredentialService,
    private readonly limits: AuthRateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'private, no-store');
    const environment = this.credentials.environment;
    if (!environment) throw new NotFoundException();

    const request = http.getRequest<CorporateRequest>();
    request.id ??= correlationId(request);
    correlationHeaders(response, request.id);
    await this.limits.check(
      'corporate-administration/connection',
      requestClientIp(request),
    );

    const peer = normalizeClientIp(request.socket.remoteAddress);
    const directTls =
      request.socket instanceof TLSSocket && request.socket.encrypted;
    const proxyTls =
      request.headers['x-forwarded-proto'] === 'https' &&
      isTrustedProxyRequest(request);
    const localLoopback =
      environment === 'local' && (peer === '::1' || peer?.startsWith('127.'));
    if (!directTls && !proxyTls && !localLoopback) {
      audit(context, 'denied', 'TLS_REQUIRED');
      throw new ForbiddenException();
    }

    const principal = this.credentials.authenticate(
      request.headers.authorization,
    );
    if (!principal) {
      audit(context, 'denied', 'UNAUTHORIZED');
      response.setHeader(
        'WWW-Authenticate',
        'Bearer realm="orbit-corporate-admin"',
      );
      throw new UnauthorizedException();
    }

    request[TECHNICAL_PRINCIPAL] = principal;
    return true;
  }
}

@Injectable()
export class CorporateCapabilityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const declared = this.reflector.get(
      RequiresCorporateCapability,
      context.getHandler(),
    );
    const request = context.switchToHttp().getRequest<CorporateRequest>();
    const required =
      declared === 'operational-status'
        ? operationalCapability(
            (request.body as { status?: unknown } | undefined)?.status,
          )
        : declared;
    const principal = request[TECHNICAL_PRINCIPAL];
    const capabilities = typeof required === 'string' ? [required] : required;
    if (
      !capabilities?.length ||
      !capabilities.every((capability) =>
        principal?.capabilities.includes(capability),
      )
    ) {
      audit(context, 'denied', 'CAPABILITY_REQUIRED');
      throw new ForbiddenException();
    }

    audit(context, 'allowed', 'ALLOWED');
    return true;
  }
}
