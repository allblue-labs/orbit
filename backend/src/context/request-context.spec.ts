import type { UUID } from '../contracts';
import { RequestContext } from './request-context';

describe('RequestContext actor boundary', () => {
  const uuid = (value: string) => value as UUID;
  const base = {
    requestId: 'request',
    userId: null,
    organizationId: null,
    businessUnitId: null,
    businessUnitIds: [] as readonly UUID[],
    roles: [] as readonly string[],
    permissions: [] as readonly string[],
    ip: null,
    userAgent: null,
    locale: 'pt-BR',
  };

  it('keeps legacy internal request construction compatible', () => {
    const context = new RequestContext({
      ...base,
      userId: uuid('01900000-0000-7000-8000-000000000001'),
    });
    expect(context.actorType).toBe('INTERNAL_USER');
    expect(context.portalIdentityId).toBeNull();
    expect(context.customerId).toBeNull();
  });

  it('carries explicit Portal scope without creating an internal user', () => {
    const context = new RequestContext({
      ...base,
      actorType: 'CUSTOMER_PORTAL',
      portalIdentityId: uuid('01900000-0000-7000-8000-000000000002'),
      organizationId: uuid('01900000-0000-7000-8000-000000000003'),
      customerId: uuid('01900000-0000-7000-8000-000000000004'),
    });
    expect(context).toMatchObject({
      actorType: 'CUSTOMER_PORTAL',
      userId: null,
      customerId: '01900000-0000-7000-8000-000000000004',
    });
  });

  it('preserves an explicit SYSTEM worker actor', () => {
    expect(new RequestContext({ ...base, actorType: 'SYSTEM' }).actorType).toBe(
      'SYSTEM',
    );
  });
});
