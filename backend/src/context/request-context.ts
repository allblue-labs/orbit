import type { IRequestContext } from '../contracts';

export class RequestContext implements IRequestContext {
  readonly requestId: IRequestContext['requestId'];
  readonly actorType: IRequestContext['actorType'];
  readonly userId: IRequestContext['userId'];
  readonly portalIdentityId: IRequestContext['portalIdentityId'];
  readonly organizationId: IRequestContext['organizationId'];
  readonly customerId: IRequestContext['customerId'];
  readonly businessUnitId: IRequestContext['businessUnitId'];
  readonly businessUnitIds: IRequestContext['businessUnitIds'];
  readonly roles: IRequestContext['roles'];
  readonly permissions: IRequestContext['permissions'];
  readonly allowedSurfaces: IRequestContext['allowedSurfaces'];
  readonly isOrganizationOwner: IRequestContext['isOrganizationOwner'];
  readonly ip: IRequestContext['ip'];
  readonly userAgent: IRequestContext['userAgent'];
  readonly locale: IRequestContext['locale'];

  constructor(
    values: Omit<
      IRequestContext,
      | 'actorType'
      | 'portalIdentityId'
      | 'customerId'
      | 'allowedSurfaces'
      | 'isOrganizationOwner'
    > &
      Partial<
        Pick<
          IRequestContext,
          | 'actorType'
          | 'portalIdentityId'
          | 'customerId'
          | 'allowedSurfaces'
          | 'isOrganizationOwner'
        >
      >,
  ) {
    this.requestId = values.requestId;
    this.actorType =
      values.actorType ?? (values.userId ? 'INTERNAL_USER' : 'ANONYMOUS');
    this.userId = values.userId;
    this.portalIdentityId = values.portalIdentityId ?? null;
    this.organizationId = values.organizationId;
    this.customerId = values.customerId ?? null;
    this.businessUnitId = values.businessUnitId;
    this.businessUnitIds = Object.freeze([...values.businessUnitIds]);
    this.roles = Object.freeze([...values.roles]);
    this.permissions = Object.freeze([...values.permissions]);
    this.allowedSurfaces = Object.freeze([...(values.allowedSurfaces ?? [])]);
    this.isOrganizationOwner = values.isOrganizationOwner ?? false;
    this.ip = values.ip;
    this.userAgent = values.userAgent;
    this.locale = values.locale;
  }
}
