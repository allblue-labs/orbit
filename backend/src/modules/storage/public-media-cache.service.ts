import { Inject, Injectable } from '@nestjs/common';
import { OutboundHttp } from '../../network/outbound-http';
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';
import type { StorageObjectRef } from './storage.types';

export class MediaCachePending extends Error {
  constructor(
    readonly code: 'CACHE_PURGE_NOT_CONFIGURED' | 'CACHE_PURGE_FAILED',
  ) {
    super(code);
  }
}
/** Origin deletion does not evict public immutable CDN objects. Private files never enter this path. */
@Injectable()
export class PublicMediaCacheService {
  constructor(
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    private readonly http: OutboundHttp,
  ) {}
  async purge(ref: StorageObjectRef): Promise<void> {
    if (
      this.config.provider !== 'R2' ||
      ref.bucket !== this.config.publicBucket
    )
      return;
    const zone = process.env.CLOUDFLARE_CACHE_PURGE_ZONE_ID?.trim();
    const token = process.env.CLOUDFLARE_CACHE_PURGE_TOKEN?.trim();
    if (
      !zone ||
      !/^[a-f0-9]{32}$/.test(zone) ||
      !token ||
      !this.config.publicUrl
    )
      throw new MediaCachePending('CACHE_PURGE_NOT_CONFIGURED');
    try {
      // Fixed API origin. Tenant-controlled data only occurs in the JSON file URL.
      const url = `${this.config.publicUrl.replace(/\/$/, '')}/${ref.objectKey.split('/').map(encodeURIComponent).join('/')}`;
      const result = await this.http.request(
        'CACHE_PURGE',
        `https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: Buffer.from(JSON.stringify({ files: [url] })),
          timeoutMs: 15000,
        },
      );
      const payload: unknown = JSON.parse(result.body.toString('utf8'));
      if (
        result.status !== 200 ||
        !payload ||
        typeof payload !== 'object' ||
        !('success' in payload) ||
        payload.success !== true
      )
        throw new Error();
    } catch {
      throw new MediaCachePending('CACHE_PURGE_FAILED');
    }
  }
}
