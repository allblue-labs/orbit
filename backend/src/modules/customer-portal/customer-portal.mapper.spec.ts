import { CustomerPortalMapper } from './customer-portal.mapper';
import type { PortalSessionRecord } from './customer-portal.types';

describe('CustomerPortalMapper', () => {
  it('publishes an explicit contract and never exposes credential hashes', () => {
    const record: PortalSessionRecord = {
      id: 'identity',
      organizationId: 'organization',
      customerId: 'customer',
      contactId: null,
      email: 'customer@example.com',
      normalizedEmail: 'customer@example.com',
      displayName: 'Customer',
      passwordHash: 'secret-hash',
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
      customerName: 'Customer SA',
      customerStatus: 'ACTIVE',
      customerDeletedAt: null,
      sessionId: 'session',
      sessionExpiresAt: new Date(),
      sessionRevokedAt: null,
    };
    const mapped = new CustomerPortalMapper().me(record);

    expect(mapped.actorType).toBe('CUSTOMER_PORTAL');
    expect(mapped.customer.id).toBe('customer');
    expect(JSON.stringify(mapped)).not.toContain('secret-hash');
    expect(mapped).not.toHaveProperty('normalizedEmail');
  });
});
