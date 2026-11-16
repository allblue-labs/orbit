import { isIP } from 'node:net';
import { isPrivateRouteAddress } from './outbound-address';

export type OutboundPurpose = 'AI' | 'WEB_PUSH';
export interface PrivateRoute {
  origin: string;
  addresses: readonly string[];
}
export interface OutboundConfiguration {
  aiOrigins: readonly string[];
  pushOrigins: readonly string[];
  privateAiRoutes: readonly PrivateRoute[];
}
export const OUTBOUND_CONFIGURATION = Symbol('OUTBOUND_CONFIGURATION');
const DEFAULT_PUSH =
  'https://fcm.googleapis.com,https://updates.push.services.mozilla.com,https://web.push.apple.com';

function origin(value: string, privateRoute = false): string {
  const url = new URL(value);
  if (
    url.hostname.includes('*') ||
    url.origin !== value ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (!privateRoute && url.port) ||
    (!privateRoute && isIP(url.hostname.replace(/^\[|\]$/g, '')))
  )
    throw new Error('Invalid outbound origin configuration');
  return url.origin;
}

/** Deployment-only exact origins. No wildcard or tenant-supplied exception. */
export function outboundConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): OutboundConfiguration {
  try {
    const list = (value: string) => [
      ...new Set(
        value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((s) => origin(s)),
      ),
    ];
    const raw: unknown = JSON.parse(
      env.OUTBOUND_AI_PRIVATE_ROUTES?.trim() || '[]',
    );
    if (!Array.isArray(raw) || raw.length > 32) throw new Error();
    const privateAiRoutes = raw.map((entry: unknown): PrivateRoute => {
      if (!entry || typeof entry !== 'object') throw new Error();
      const route = entry as Record<string, unknown>;
      if (
        typeof route.origin !== 'string' ||
        !Array.isArray(route.addresses) ||
        !route.addresses.length ||
        route.addresses.length > 16 ||
        route.addresses.some(
          (ip: unknown) => typeof ip !== 'string' || !isPrivateRouteAddress(ip),
        )
      )
        throw new Error();
      return {
        origin: origin(route.origin, true),
        addresses: route.addresses as string[],
      };
    });
    if (
      new Set(privateAiRoutes.map((r) => r.origin)).size !==
      privateAiRoutes.length
    )
      throw new Error();
    return Object.freeze({
      aiOrigins: list(env.OUTBOUND_AI_ORIGINS ?? 'https://api.openai.com'),
      pushOrigins: list(env.OUTBOUND_WEB_PUSH_ORIGINS ?? DEFAULT_PUSH),
      privateAiRoutes,
    });
  } catch {
    // Never include URLs, query strings or credentials in startup errors.
    throw new Error(
      'Invalid OUTBOUND_AI_ORIGINS, OUTBOUND_WEB_PUSH_ORIGINS or OUTBOUND_AI_PRIVATE_ROUTES configuration',
    );
  }
}
