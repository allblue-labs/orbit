import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { requestClientIp } from './trusted-client-origin';

const SENSITIVE_PATH =
  /^(?:identity\/(?:login|register|refresh|biometrics\/(?:webauthn\/authentication(?:\/options)?|devices\/login)|email\/(?:verify|resend)|password\/(?:forgot|reset(?:\/validate)?)|me\/mfa\/(?:enrollment|enable))|portal\/auth\/(?:login|refresh|biometrics\/(?:webauthn\/authentication(?:\/options)?|devices\/login)|activate|password\/reset-(?:request|confirm))|public\/contact|billing\/(?:checkout-session|portal-session))$/;

const PUBLIC_QUOTE =
  /^public\/quotes\/proposals\/([^/]+)\/(response|document\/exports)$/i;
const PASSKEY_CHALLENGE =
  /^(?:identity\/biometrics|portal\/auth\/biometrics)\/webauthn\/authentication\/options$/;

/** Redis budgets with PostgreSQL fallback for credential and capability routes. */
@Injectable()
export class SensitiveEndpointRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly limits: AuthRateLimitService) {}

  async use(
    request: Request,
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    const rawPath = request.path
      .replace(/^\/(?:api\/v1\/)?/i, '')
      .replace(/\/+$/, '');
    if (request.method !== 'POST') return next();
    const quote = PUBLIC_QUOTE.exec(rawPath);
    if (quote) {
      let token: string | undefined;
      try {
        const decoded = decodeURIComponent(quote[1]!);
        if (/^[A-Za-z0-9_-]{64}$/.test(decoded)) token = `token:${decoded}`;
      } catch {
        // Even malformed paths consume their IP budget.
      }
      await this.limits.check(
        `public/quotes/${quote[2]!.toLowerCase()}`,
        requestClientIp(request),
        token,
      );
      return next();
    }
    const path = rawPath.toLowerCase();
    if (PASSKEY_CHALLENGE.test(path)) {
      await this.limits.check('passkey-challenge', requestClientIp(request));
      return next();
    }
    if (!SENSITIVE_PATH.test(path)) return next();
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
