import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../context';

export interface RlsContext {
  actorType: string;
  userId: string;
  portalIdentityId: string;
  organizationId: string;
  customerId: string;
  businessUnitId: string;
  businessUnitIds: string;
  roles: string;
  permissions: string;
  isPlatformAdmin: string;
}

@Injectable()
export class RlsContextProvider {
  constructor(private readonly contexts: RequestContextService) {}

  get(): RlsContext {
    const context = this.contexts.get();
    return {
      actorType: context.actorType,
      userId: context.userId ?? '',
      portalIdentityId: context.portalIdentityId ?? '',
      organizationId: context.organizationId ?? '',
      customerId: context.customerId ?? '',
      businessUnitId: context.businessUnitId ?? '',
      businessUnitIds: context.businessUnitIds.join(','),
      roles: context.roles.join(','),
      permissions: context.permissions.join(','),
      isPlatformAdmin: String(context.roles.includes('PLATFORM_ADMIN')),
    };
  }
}
