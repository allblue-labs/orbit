import { JwtService } from '@nestjs/jwt';
import { generateUuidV7 } from '../../../utils';
import { IdentityTokenService } from './token.service';

describe('IdentityTokenService', () => {
  const jwt = new JwtService({
    secret: 'unit-test-secret-at-least-32-bytes',
    signOptions: { issuer: 'orbit-api', audience: 'orbit' },
    verifyOptions: { issuer: 'orbit-api', audience: 'orbit' },
  });
  const service = new IdentityTokenService(jwt);

  it('issues an opaque refresh token and verifiable access claims', async () => {
    const userId = generateUuidV7();
    const sessionId = generateUuidV7();
    const pair = await service.issue({
      id: userId,
      sessionId,
      organizationId: null,
      businessUnitId: null,
      businessUnitIds: [],
      roles: ['MEMBER'],
      permissions: ['profile.read'],
      allowedSurfaces: ['WEB', 'MOBILE'],
      isOrganizationOwner: false,
    });

    expect(pair.refreshToken).not.toBe(pair.refreshTokenHash);
    expect(service.hashOpaqueToken(pair.refreshToken)).toBe(
      pair.refreshTokenHash,
    );
    const claims = await service.verifyAccessToken(pair.accessToken);
    expect(claims.sub).toBe(userId);
    expect(claims.sid).toBe(sessionId);
    expect(claims.type).toBe('access');
  });

  it('generates unique opaque tokens', () => {
    const first = service.generateOpaqueToken();
    const second = service.generateOpaqueToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(32);
  });

  it('preserves branded UUID values', () => {
    const value = generateUuidV7();
    expect(service.asUuid(value)).toBe(value);
  });
});
