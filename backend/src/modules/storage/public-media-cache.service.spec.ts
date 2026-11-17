import {
  PublicMediaCacheService,
  MediaCachePending,
} from './public-media-cache.service';
import type { StorageConfig } from './storage.config';
import type { OutboundHttp } from '../../network/outbound-http';
describe('public media cache deletion', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  function fixture() {
    const http = {
      request: jest.fn().mockResolvedValue({
        status: 200,
        body: Buffer.from('{"success":true}'),
      }),
    };
    const config = {
      provider: 'R2',
      publicBucket: 'public',
      publicUrl: 'https://cdn.example.test',
    } as StorageConfig;
    return {
      http,
      service: new PublicMediaCacheService(
        config,
        http as unknown as OutboundHttp,
      ),
    };
  }
  it('never calls a CDN for private files', async () => {
    const { http, service } = fixture();
    await service.purge({ bucket: 'private', objectKey: 'proof.pdf' });
    expect(http.request).not.toHaveBeenCalled();
  });
  it('does not claim public completion without purge credentials', async () => {
    delete process.env.CLOUDFLARE_CACHE_PURGE_TOKEN;
    await expect(
      fixture().service.purge({ bucket: 'public', objectKey: 'avatar.webp' }),
    ).rejects.toBeInstanceOf(MediaCachePending);
  });
  it('purges only the encoded public URL through the fixed, protected Cloudflare API', async () => {
    process.env.CLOUDFLARE_CACHE_PURGE_ZONE_ID = 'a'.repeat(32);
    process.env.CLOUDFLARE_CACHE_PURGE_TOKEN = 'synthetic-token';
    const { http, service } = fixture();
    await service.purge({
      bucket: 'public',
      objectKey: 'avatars/org/name ?#.webp',
    });
    const [purpose, url, input] = http.request.mock.calls[0] as [
      string,
      string,
      { body: Buffer },
    ];
    expect(purpose).toBe('CACHE_PURGE');
    expect(url).toBe(
      `https://api.cloudflare.com/client/v4/zones/${'a'.repeat(32)}/purge_cache`,
    );
    expect(JSON.parse(input.body.toString())).toEqual({
      files: ['https://cdn.example.test/avatars/org/name%20%3F%23.webp'],
    });
    http.request.mockResolvedValue({
      status: 200,
      body: Buffer.from('{"success":false}'),
    });
    await expect(
      service.purge({ bucket: 'public', objectKey: 'avatar.webp' }),
    ).rejects.toMatchObject({ code: 'CACHE_PURGE_FAILED' });
  });
});
