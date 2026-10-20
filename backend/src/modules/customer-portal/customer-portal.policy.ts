import { Injectable } from '@nestjs/common';
import { EntityNotFoundException } from '../../exceptions';
import type { CustomerPortalActor } from './customer-portal.types';

export interface CustomerPortalOwnedResource {
  organizationId: string;
  customerId: string | null;
}

/**
 * Mandatory ownership boundary for PR-33+ read models.
 *
 * Controllers never receive an arbitrary customer selector. Repositories use
 * `scope()` in their predicates and policies call `assertOwns()` before
 * mapping a resource. A mismatch deliberately has 404 semantics to prevent
 * cross-customer resource probing.
 */
@Injectable()
export class CustomerPortalAuthorizationPolicy {
  scope(actor: CustomerPortalActor): Readonly<{
    organizationId: string;
    customerId: string;
  }> {
    return Object.freeze({
      organizationId: actor.organizationId,
      customerId: actor.customerId,
    });
  }

  assertOwns(
    actor: CustomerPortalActor,
    resource: CustomerPortalOwnedResource | null,
    resourceName = 'Portal resource',
  ): asserts resource is CustomerPortalOwnedResource {
    if (
      !resource ||
      resource.organizationId !== actor.organizationId ||
      resource.customerId !== actor.customerId
    ) {
      throw new EntityNotFoundException(resourceName);
    }
  }
}
