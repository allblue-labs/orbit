import { Injectable } from '@nestjs/common';
import type {
  CustomerPortalInvitation,
  CustomerPortalIdentity,
} from '@prisma/client';
import { InfrastructureException } from '../../exceptions';
import type { PortalSessionRecord } from './customer-portal.types';
import type {
  CustomerPortalInvitationReadModel,
  CustomerPortalMeReadModel,
} from './customer-portal.read-models';

@Injectable()
export class CustomerPortalMapper {
  me(record: PortalSessionRecord): CustomerPortalMeReadModel {
    return {
      actorType: 'CUSTOMER_PORTAL',
      identity: {
        id: record.id,
        displayName: record.displayName,
        email: record.email,
        status: this.status(record.status),
        contactId: record.contactId,
      },
      organization: {
        id: record.organizationId,
        slug: record.organizationSlug,
        displayName: record.organizationName,
      },
      customer: {
        id: record.customerId,
        displayName: record.customerName,
      },
      sessionId: record.sessionId,
    };
  }

  invitation(
    invitation: CustomerPortalInvitation & {
      identity: CustomerPortalIdentity;
    },
  ): CustomerPortalInvitationReadModel {
    return {
      id: invitation.id,
      identityId: invitation.portalIdentityId,
      customerId: invitation.customerId,
      displayName: invitation.identity.displayName,
      email: invitation.identity.email,
      expiresAt: invitation.expiresAt.toISOString(),
      status: 'invited',
    };
  }

  private status(
    value: string,
  ): CustomerPortalMeReadModel['identity']['status'] {
    switch (value) {
      case 'INVITED':
        return 'invited';
      case 'ACTIVE':
        return 'active';
      case 'DISABLED':
        return 'disabled';
      default:
        throw new InfrastructureException('Invalid customer portal status');
    }
  }
}
