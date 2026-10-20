import { JwtService } from '@nestjs/jwt';
import type { UUID } from '../../contracts';
import { EnvironmentProvider } from '../../providers';
import { IdentityTokenService } from '../identity/application/token.service';
import { CustomerPortalTokenService } from './customer-portal-token.service';

describe('CustomerPortalTokenService', () => {
  const uuid = (value: string) => value as UUID;
  const secret = 'test-secret-with-more-than-thirty-two-characters';
  const environment = {
    get: () => secret,
    getOptional: (key: string) =>
      key === 'JWT_ACCESS_SECRET'
        ? secret
        : key === 'JWT_ISSUER'
          ? 'orbit-api'
          : key === 'JWT_AUDIENCE'
            ? 'orbit'
            : undefined,
  } as EnvironmentProvider;

  it('issues minimal CUSTOMER_PORTAL claims without internal RBAC', async () => {
    const service = new CustomerPortalTokenService(
      new JwtService(),
      environment,
    );
    const pair = await service.issue({
      actorType: 'CUSTOMER_PORTAL',
      identityId: uuid('01900000-0000-7000-8000-000000000001'),
      sessionId: uuid('01900000-0000-7000-8000-000000000002'),
      organizationId: uuid('01900000-0000-7000-8000-000000000003'),
      customerId: uuid('01900000-0000-7000-8000-000000000004'),
    });
    const claims = await service.verifyAccessToken(pair.accessToken);

    expect(claims.actorType).toBe('CUSTOMER_PORTAL');
    expect(claims.type).toBe('portal_access');
    expect(claims).not.toHaveProperty('roles');
    expect(claims).not.toHaveProperty('permissions');
    expect(pair.refreshToken).not.toBe(pair.refreshTokenHash);
  });

  it('cannot be substituted for an internal access token', async () => {
    const portal = new CustomerPortalTokenService(
      new JwtService(),
      environment,
    );
    const internalJwt = new JwtService({
      secret,
      signOptions: { issuer: 'orbit-api', audience: 'orbit' },
      verifyOptions: { issuer: 'orbit-api', audience: 'orbit' },
    });
    const internal = new IdentityTokenService(internalJwt);
    const pair = await portal.issue({
      actorType: 'CUSTOMER_PORTAL',
      identityId: uuid('01900000-0000-7000-8000-000000000001'),
      sessionId: uuid('01900000-0000-7000-8000-000000000002'),
      organizationId: uuid('01900000-0000-7000-8000-000000000003'),
      customerId: uuid('01900000-0000-7000-8000-000000000004'),
    });

    await expect(
      internal.verifyAccessToken(pair.accessToken),
    ).rejects.toThrow();
  });
});
