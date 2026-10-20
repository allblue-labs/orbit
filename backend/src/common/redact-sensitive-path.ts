/** Prevent opaque physical identifiers from becoming credentials in logs. */
export function redactSensitivePath(path: string | undefined): string | null {
  if (!path) return null;
  const pathname = path.split('?', 1)[0] ?? path;
  return pathname.replace(/(\/assets\/qr\/)[^/?]+/g, '$1[REDACTED]');
}
