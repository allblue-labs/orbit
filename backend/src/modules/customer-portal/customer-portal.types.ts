import type { UUID } from '../../contracts';

export const CUSTOMER_PORTAL_TOKEN_DELIVERY = Symbol(
  'CUSTOMER_PORTAL_TOKEN_DELIVERY',
);

export type CustomerPortalTokenPurpose = 'INVITATION' | 'PASSWORD_RESET';

export interface CustomerPortalTokenDelivery {
  deliver(
    purpose: CustomerPortalTokenPurpose,
    recipient: string,
    token: string,
  ): Promise<void>;
}

export interface CustomerPortalClaims {
  sub: UUID;
  sid: UUID;
  actorType: 'CUSTOMER_PORTAL';
  organizationId: UUID;
  customerId: UUID;
  type: 'portal_access';
}

export interface CustomerPortalActor {
  actorType: 'CUSTOMER_PORTAL';
  identityId: UUID;
  sessionId: UUID;
  organizationId: UUID;
  customerId: UUID;
}

export interface PortalIdentityRecord {
  id: string;
  organizationId: string;
  customerId: string;
  contactId: string | null;
  email: string;
  normalizedEmail: string;
  displayName: string;
  passwordHash: string | null;
  status: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  disabledAt: Date | null;
  organizationSlug: string;
  organizationName: string;
  organizationStatus: string;
  organizationDeletedAt: Date | null;
  customerName: string;
  customerStatus: string;
  customerDeletedAt: Date | null;
}

export interface PortalSessionRecord extends PortalIdentityRecord {
  sessionId: string;
  sessionExpiresAt: Date;
  sessionRevokedAt: Date | null;
  refreshTokenHash?: string;
}
