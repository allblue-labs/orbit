const storage = "https://*.r2.cloudflarestorage.com";
const publicMedia = "https://cdn-orbit.allblue-labs.com";
const sentry = [
  "https://*.ingest.sentry.io",
  "https://*.ingest.us.sentry.io",
  "https://*.ingest.de.sentry.io",
].join(" ");

export function contentSecurityPolicy({
  nonce,
  allowSameOriginFrame,
  development,
}: {
  nonce: string;
  allowSameOriginFrame: boolean;
  development: boolean;
}): string {
  const devScript = development ? " 'unsafe-eval'" : "";
  const devSocket = development ? " ws: wss:" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devScript}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${publicMedia} ${storage}`,
    "font-src 'self'",
    `connect-src 'self' ${publicMedia} ${storage} ${sentry}${devSocket}`,
    `frame-src 'self' blob: ${storage}`,
    `frame-ancestors '${allowSameOriginFrame ? "self" : "none"}'`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}
