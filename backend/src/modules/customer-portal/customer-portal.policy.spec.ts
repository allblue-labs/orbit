import type { UUID } from '../../contracts';
import { EntityNotFoundException } from '../../exceptions';
import { CustomerPortalAuthorizationPolicy } from './customer-portal.policy';
import type { CustomerPortalActor } from './customer-portal.types';

describe('CustomerPortalAuthorizationPolicy', () => {
  const uuid = (value: string) => value as UUID;
  const actor: CustomerPortalActor = {
    actorType: 'CUSTOMER_PORTAL',
    identityId: uuid('01900000-0000-7000-8000-000000000001'),
    sessionId: uuid('01900000-0000-7000-8000-000000000002'),
    organizationId: uuid('01900000-0000-7000-8000-000000000003'),
    customerId: uuid('01900000-0000-7000-8000-000000000004'),
  };
  const policy = new CustomerPortalAuthorizationPolicy();

  it('derives repository scope exclusively from the validated actor', () => {
    expect(policy.scope(actor)).toEqual({
      organizationId: actor.organizationId,
      customerId: actor.customerId,
    });
  });

  it.each([
    {
      organizationId: '01900000-0000-7000-8000-000000000099',
      customerId: actor.customerId,
    },
    {
      organizationId: actor.organizationId,
      customerId: '01900000-0000-7000-8000-000000000099',
    },
    null,
  ])('uses hidden-absence semantics for foreign resources', (resource) => {
    expect(() => policy.assertOwns(actor, resource)).toThrow(
      EntityNotFoundException,
    );
  });
});
