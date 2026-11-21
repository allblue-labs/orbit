import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * O segredo do aparelho: 256 bits que o app guarda atrás da biometria.
 * O servidor só conhece o SHA-256 — basta para conferir, não para entrar.
 */
export function newDeviceSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: hashDeviceSecret(secret) };
}

export function hashDeviceSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function deviceSecretMatches(secret: string, hash: string): boolean {
  const given = Buffer.from(hashDeviceSecret(secret), 'hex');
  const stored = Buffer.from(hash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}
