import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const PROXY_SECRET_HEADER = 'x-orbit-proxy-secret';
export const CLIENT_IP_HEADER = 'x-orbit-client-ip';

/** Single address, never an X-Forwarded-For chain or a hostname. */
export function normalizeClientIp(value: string | undefined): string | null {
  if (!value || value.length > 64 || value !== value.trim()) return null;
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4)
    return value.slice(7);
  const family = isIP(value);
  if (family === 4) return value;
  if (family === 6 && !value.includes('%'))
    return new URL(`http://[${value}]`).hostname.slice(1, -1);
  return null;
}

/** Only the internal ingress/BFF credential can attest a forwarded address.
 * Published application ports must remain loopback/private. */
export function requestClientIp(request: Request): string {
  const secret = process.env.TRUSTED_PROXY_SECRET ?? '';
  const supplied = request.headers?.[PROXY_SECRET_HEADER];
  if (
    secret.length >= 32 &&
    typeof supplied === 'string' &&
    Buffer.byteLength(supplied) === Buffer.byteLength(secret) &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
  ) {
    const ip = request.headers?.[CLIENT_IP_HEADER];
    if (typeof ip === 'string') {
      const normalized = normalizeClientIp(ip);
      if (normalized) return normalized;
    }
  }
  return normalizeClientIp(request.socket?.remoteAddress) ?? '0.0.0.0';
}
