import { loadStorageConfig } from './storage.config';
const account = 'a'.repeat(32);
const environment = {
  R2_ACCOUNT_ID: account,
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET_NAME: 'orbit-assets',
  R2_PRIVATE_BUCKET_NAME: 'orbit-assets-private',
  R2_ENDPOINT: `https://${account}.r2.cloudflarestorage.com`,
  R2_PUBLIC_URL: 'https://cdn-orbit.allblue-labs.com',
  JWT_ACCESS_SECRET: 'test-secret',
  IDENTITY_PUBLIC_WEB_URL: 'https://orbit.allblue-labs.com',
};
describe('R2 configuration', () => {
  it('uses separate buckets, auto region and the official account endpoint', () => {
    expect(loadStorageConfig(environment)).toMatchObject({
      provider: 'R2',
      bucket: 'orbit-assets-private',
      publicBucket: 'orbit-assets',
      localPublicBaseUrl: 'https://orbit.allblue-labs.com/api/v1',
      s3: {
        region: 'auto',
        legacyBucketAliases: { 'orbit-artifacts': 'orbit-assets-private' },
      },
    });
  });
  it.each([
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_ENDPOINT',
    'R2_PUBLIC_URL',
    'R2_BUCKET_NAME',
    'R2_PRIVATE_BUCKET_NAME',
  ])('fails closed without %s', (key) => {
    expect(() => loadStorageConfig({ ...environment, [key]: '' })).toThrow();
  });
  it('refuses public/private collision, HTTP and mismatched account endpoints', () => {
    for (const patch of [
      { R2_PRIVATE_BUCKET_NAME: 'orbit-assets' },
      { R2_PUBLIC_URL: 'http://cdn-orbit.allblue-labs.com' },
      { R2_ENDPOINT: 'https://example.com' },
    ])
      expect(() => loadStorageConfig({ ...environment, ...patch })).toThrow();
  });
});
