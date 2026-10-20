import type { IHashProvider, IUuidProvider } from '../../contracts';
import { UnauthorizedException } from '../../exceptions';
import type { CustomerPortalTokenDelivery } from './customer-portal.types';
import { CustomerPortalMapper } from './customer-portal.mapper';
import { CustomerPortalMetrics } from './customer-portal.metrics';
import { CustomerPortalRepository } from './customer-portal.repository';
import { CustomerPortalService } from './customer-portal.service';
import { CustomerPortalTokenService } from './customer-portal-token.service';
import type { PortalIdentityRecord } from './customer-portal.types';

describe('CustomerPortalService', () => {
  const identity = (status = 'ACTIVE'): PortalIdentityRecord => ({
    id: '01900000-0000-7000-8000-000000000001',
    organizationId: '01900000-0000-7000-8000-000000000002',
    customerId: '01900000-0000-7000-8000-000000000003',
    contactId: null,
    email: 'portal@example.com',
    normalizedEmail: 'portal@example.com',
    displayName: 'Portal Customer',
    passwordHash: 'argon-hash',
    status,
    failedAttempts: 0,
    lockedUntil: null,
    emailVerifiedAt: new Date(),
    lastLoginAt: null,
    disabledAt: status === 'DISABLED' ? new Date() : null,
    organizationSlug: 'acme',
    organizationName: 'Acme',
    organizationStatus: 'ACTIVE',
    organizationDeletedAt: null,
    customerName: 'Acme Customer',
    customerStatus: 'ACTIVE',
    customerDeletedAt: null,
  });

  const setup = (record: PortalIdentityRecord | null = identity()) => {
    const repository = {
      consumeRateLimit: jest
        .fn()
        .mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
      findLoginIdentity: jest.fn().mockResolvedValue(record),
      recordFailedLogin: jest.fn().mockResolvedValue(undefined),
      createSession: jest.fn().mockImplementation((data: { id: string }) =>
        Promise.resolve({
          ...(record ?? identity()),
          sessionId: data.id,
          sessionExpiresAt: new Date(Date.now() + 60_000),
          sessionRevokedAt: null,
        }),
      ),
    };
    const verify = jest.fn().mockResolvedValue(true);
    const hashes: IHashProvider = {
      hash: jest.fn().mockResolvedValue('dummy-hash'),
      verify,
    };
    const uuids: IUuidProvider = {
      generate: jest
        .fn()
        .mockReturnValue('01900000-0000-7000-8000-000000000004'),
    };
    const tokens = {
      issue: jest.fn().mockResolvedValue({
        accessToken: 'portal-access',
        refreshToken: 'portal-refresh',
        refreshTokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 60_000),
        tokenType: 'Bearer',
        expiresIn: 900,
      }),
    };
    const delivery: CustomerPortalTokenDelivery = {
      deliver: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CustomerPortalService(
      repository as unknown as CustomerPortalRepository,
      tokens as unknown as CustomerPortalTokenService,
      new CustomerPortalMapper(),
      new CustomerPortalMetrics(),
      hashes,
      uuids,
      delivery,
    );
    return { service, repository, verify, tokens };
  };

  it('derives organization/customer from the persisted identity when logging in', async () => {
    const { service, repository, tokens } = setup();
    const result = await service.login(
      {
        organizationSlug: 'ACME',
        email: 'PORTAL@example.com',
        password: 'valid-password',
      },
      { ipAddress: '127.0.0.1' },
    );

    expect(repository.findLoginIdentity).toHaveBeenCalledWith(
      'acme',
      'portal@example.com',
    );
    expect(tokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: 'CUSTOMER_PORTAL',
        organizationId: identity().organizationId,
        customerId: identity().customerId,
      }),
    );
    expect(result.me.actorType).toBe('CUSTOMER_PORTAL');
  });

  it('uses a dummy hash and the same generic error for an unknown identity', async () => {
    const { service, verify, repository } = setup(null);

    await expect(
      service.login(
        {
          organizationSlug: 'unknown',
          email: 'unknown@example.com',
          password: 'invalid-password',
        },
        {},
      ),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'Invalid credentials',
    });
    expect(verify).toHaveBeenCalledWith('dummy-hash', 'invalid-password');
    expect(repository.recordFailedLogin).not.toHaveBeenCalled();
  });

  it.each([
    ['DISABLED', identity('DISABLED')],
    ['inactive customer', { ...identity(), customerStatus: 'INACTIVE' }],
    [
      'inactive organization',
      { ...identity(), organizationStatus: 'SUSPENDED' },
    ],
  ])('denies %s without issuing a session', async (_label, record) => {
    const { service, tokens } = setup(record);
    await expect(
      service.login(
        {
          organizationSlug: 'acme',
          email: 'portal@example.com',
          password: 'valid-password',
        },
        {},
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(tokens.issue).not.toHaveBeenCalled();
  });

  it('fails closed when the distributed rate limiter denies the attempt', async () => {
    const { service, repository } = setup();
    repository.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });

    await expect(
      service.login(
        {
          organizationSlug: 'acme',
          email: 'portal@example.com',
          password: 'valid-password',
        },
        {},
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(repository.findLoginIdentity).not.toHaveBeenCalled();
  });
});
