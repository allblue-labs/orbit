import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { requestClientIp } from './trusted-client-origin';

const SENSITIVE_PATH =
  /^(?:identity\/(?:login|register|refresh|email\/(?:verify|resend)|password\/(?:forgot|reset)|me\/mfa\/(?:enrollment|enable))|portal\/auth\/(?:login|refresh|activate|password\/reset-(?:request|confirm))|billing\/(?:checkout-session|portal-session))$/;

/** Shared database budgets. No test-runtime bypass or per-process fallback. */
@Injectable()
export class SensitiveEndpointRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limits: AuthRateLimitService) {}

  async use(
    request: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    const path = request.path
      .toLowerCase()
      .replace(/^\/(?:api\/v1\/)?/, '')
      .replace(/\/+$/, '');
    if (request.method !== 'POST' || !SENSITIVE_PATH.test(path)) return next();
    const body = request.body as Record<string, unknown> | undefined;
    const email =
      typeof body?.email === 'string'
        ? body.email.trim().toLowerCase().slice(0, 320)
        : null;
    const token =
      typeof body?.refreshToken === 'string'
        ? body.refreshToken
        : typeof body?.token === 'string'
          ? body.token
          : null;
    const bearer = request.headers.authorization;
    const tenant =
      path.startsWith('portal/') && typeof body?.organizationSlug === 'string'
        ? body.organizationSlug.trim().toLowerCase().slice(0, 100)
        : '';
    const account = email
      ? `email:${tenant}:${email}`
      : token
        ? `token:${token.slice(0, 2048)}`
        : bearer
          ? `bearer:${bearer.slice(0, 8192)}`
          : undefined;
    await this.limits.check(path, requestClientIp(request), account);
    next();
  }
}
