import { AsyncLocalStorage } from "node:async_hooks";
import { isIP } from "node:net";
import { timingSafeEqual } from "node:crypto";

const origins = new AsyncLocalStorage<string | null>();
const secretHeader = "x-orbit-proxy-secret";
const ipHeader = "x-orbit-client-ip";

function normalizeIp(value: string | null): string | null {
  if (!value || value.length > 64 || value !== value.trim()) return null;
  if (value.startsWith("::ffff:") && isIP(value.slice(7)) === 4)
    return value.slice(7);
  if (isIP(value) === 4) return value;
  if (isIP(value) === 6 && !value.includes("%"))
    return new URL(`http://[${value}]`).hostname.slice(1, -1);
  return null;
}

/** Nginx overwrites both headers. No browser-supplied forwarding chain is read. */
export function trustedOrigin(request: Request): string | null {
  const secret = process.env.TRUSTED_PROXY_SECRET ?? "";
  const supplied = request.headers.get(secretHeader) ?? "";
  if (
    secret.length < 32 ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(secret) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))
  )
    return null;
  return normalizeIp(request.headers.get(ipHeader));
}

export function withClientOrigin<T>(request: Request, action: () => T): T {
  return origins.run(trustedOrigin(request), action);
}

/** Generated last, so caller headers cannot replace this authority. Outside an
 * HTTP request (public catalog builds, jobs), no origin is invented. */
export function clientOriginHeaders(): Record<string, string> {
  const ip = origins.getStore();
  const secret = process.env.TRUSTED_PROXY_SECRET;
  return ip && secret ? { [ipHeader]: ip, [secretHeader]: secret } : {};
}
