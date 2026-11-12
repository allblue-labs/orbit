/** A short-lived capability for a single reserved upload, never an arbitrary key. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { StorageConfig } from './storage.config';
import type { SignedUrl, SignedUrlRequest } from './storage.types';

export function uploadGrant(
  config: StorageConfig,
  request: SignedUrlRequest,
): SignedUrl {
  const expiresAt = new Date(Date.now() + request.expiresInSeconds * 1000);
  const expires = Math.floor(expiresAt.getTime() / 1000);
  const url = new URL(
    `${config.localPublicBaseUrl.replace(/\/$/, '')}/storage/objects`,
  );
  for (const [key, value] of Object.entries({
    bucket: request.bucket,
    key: request.objectKey,
    operation: 'upload',
    expires: String(expires),
    signature: signature(config, request.bucket, request.objectKey, expires),
  }))
    url.searchParams.set(key, value);
  return {
    url: url.toString(),
    expiresAt,
    method: 'PUT',
    requiredHeaders: {
      'content-type': request.mimeType ?? 'application/octet-stream',
      'x-orbit-upload-mode': 'multipart',
    },
  };
}
function signature(
  config: StorageConfig,
  bucket: string,
  key: string,
  expires: number,
): string {
  return createHmac('sha256', config.localSigningSecret)
    .update(`orbit-upload-v2|${bucket}|${key}|${expires}`)
    .digest('hex');
}
export function verifyUploadGrant(
  config: StorageConfig,
  query: { bucket: string; key: string; expires: number; signature: string },
): boolean {
  if (
    query.expires * 1000 <= Date.now() ||
    query.expires * 1000 > Date.now() + 3_600_000
  )
    return false;
  const actual = Buffer.from(query.signature, 'hex');
  const expected = Buffer.from(
    signature(config, query.bucket, query.key, query.expires),
    'hex',
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
