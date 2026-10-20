import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '../../exceptions';
import { CustomerPortalGuard } from './customer-portal.guard';
import { CustomerPortalRepository } from './customer-portal.repository';
import { CustomerPortalTokenService } from './customer-portal-token.service';
import type { PortalSessionRecord } from './customer-portal.types';

describe('CustomerPortalGuard', () => {
  const record: PortalSessionRecord = {
    id: '01900000-0000-7000-8000-000000000001',
    organizationId: '01900000-0000-7000-8000-000000000002',
    customerId: '01900000-0000-7000-8000-000000000003',
    contactId: null,
    email: 'portal@example.com',
    normalizedEmail: 'portal@example.com',
    displayName: 'Portal Customer',
    passwordHash: 'hash',
    status: 'ACTIVE',
    failedAttempts: 0,
    lockedUntil: null,
    emailVerifiedAt: new Date(),
    lastLoginAt: new Date(),
    disabledAt: null,
    organizationSlug: 'acme',
    organizationName: 'Acme',
    organizationStatus: 'ACTIVE',
    organizationDeletedAt: null,
    customerName: 'Customer',
    customerStatus: 'ACTIVE',
    customerDeletedAt: null,
    sessionId: '01900000-0000-7000-8000-000000000004',
    sessionExpiresAt: new Date(Date.now() + 60_000),
    sessionRevokedAt: null,
  };

  const setup = (session: PortalSessionRecord | null = record) => {
    const request = {
      header: jest.fn().mockReturnValue('Bearer portal-token'),
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as ExecutionContext;
    const tokens = {
      verifyAccessToken: jest.fn().mockResolvedValue({
        sub: record.id,
        sid: record.sessionId,
        actorType: 'CUSTOMER_PORTAL',
        organizationId: record.organizationId,
        customerId: record.customerId,
        type: 'portal_access',
      }),
      asUuid: (value: string) => value,
    };
    const repository = {
      resolveSession: jest.fn().mockResolvedValue(session),
    };
    const guard = new CustomerPortalGuard(
      tokens as unknown as CustomerPortalTokenService,
      repository as unknown as CustomerPortalRepository,
    );
    return { guard, context, request, tokens };
  };

  it('establishes a portal-only actor without creating an internal user', async () => {
    const { guard, context, request } = setup();
    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request).toMatchObject({
      actorType: 'CUSTOMER_PORTAL',
      portalIdentityId: record.id,
      organizationId: record.organizationId,
      customerId: record.customerId,
    });
    expect(request).not.toHaveProperty('user');
    expect(request).not.toHaveProperty('identity');
  });

  it('rejects tokens whose session/customer binding cannot be revalidated', async () => {
    const { guard, context } = setup(null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a token without the explicit portal actor/type', async () => {
    const { guard, context, tokens } = setup();
    tokens.verifyAccessToken.mockResolvedValue({
      sub: record.id,
      sid: record.sessionId,
      type: 'access',
    });
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
