import { Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { TechnicalCredentialService } from './technical-credential.service';

describe('TechnicalCredentialService configuration', () => {
  const principalId = randomUUID();
  const secret = randomBytes(32).toString('base64url');
  const key = 'synthetic';
  const token = 'Bearer orbit-ca1.local.' + key + '.' + secret;
  const expiresAt = '2026-11-30T00:00:00.000Z';
  const valid = {
    keyId: key,
    principalId,
    environment: 'local',
    secretSha256: createHash('sha256')
      .update(['orbit-corporate-admin.v1', 'local', key, secret].join('\0'))
      .digest('hex'),
    expiresAt,
    revoked: false,
    capabilities: ['connection:read'],
  };

  function setup(records: unknown, overrides: NodeJS.ProcessEnv = {}) {
    jest.replaceProperty(process, 'env', {
      NODE_ENV: 'test',
      ORBIT_CORPORATE_ADMIN_ENABLED: 'true',
      ORBIT_CORPORATE_ADMIN_CREDENTIALS: JSON.stringify(records),
      ...overrides,
    });
    return new TechnicalCredentialService();
  }

  let warning: jest.SpyInstance;
  beforeEach(() => {
    warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('requires explicit enablement and accepts the credential only before the expiry', () => {
    const disabled = setup([valid], {
      ORBIT_CORPORATE_ADMIN_ENABLED: undefined,
    });
    expect(disabled.environment).toBeUndefined();
    const service = setup([valid]);
    const expiry = Date.parse(expiresAt);
    expect(service.authenticate(token, expiry - 1)).toEqual({
      id: principalId,
      capabilities: ['connection:read'],
    });
    expect(service.authenticate(token, expiry)).toBeNull();
  });

  it.each([
    ['mixed deployment', [{ ...valid, environment: 'production' }]],
    ['duplicate key IDs', [valid, valid]],
    ['wildcard', [{ ...valid, capabilities: ['*'] }]],
    [
      'duplicate grants',
      [
        {
          ...valid,
          capabilities: ['organizations:read', 'organizations:read'],
        },
      ],
    ],
    [
      'overprivileged capability',
      [{ ...valid, capabilities: ['platform.admin'] }],
    ],
    ['unknown configuration field', [{ ...valid, secret }]],
    [
      'impossible calendar day',
      [{ ...valid, expiresAt: '2026-02-30T00:00:00Z' }],
    ],
  ])('disables only the corporate boundary on %s', (_name, malformed) => {
    const service = setup(malformed);
    expect(service.environment).toBeUndefined();
    expect(service.authenticate(token)).toBeNull();
    expect(warning).toHaveBeenCalledWith({
      event: 'corporate_admin_config',
      outcome: 'disabled',
      code: 'INVALID_CONFIGURATION',
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(warning.mock.calls)).not.toContain(
      valid.secretSha256,
    );
  });

  it('requires a deployed environment when NODE_ENV is production', () => {
    const service = setup([valid], {
      NODE_ENV: 'production',
    });
    expect(service.environment).toBeUndefined();
  });
});
