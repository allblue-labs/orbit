import {
  projectPlatformSubscription,
  type PlatformSubscriptionSnapshot,
} from './platform-subscription.projection';
import { isOrganizationOperational } from '../tenant-operations/tenant-operation-state';

type DateField =
  | 'billingAnchorAt'
  | 'currentPeriodStart'
  | 'currentPeriodEnd'
  | 'trialEndsAt'
  | 'graceStartsAt'
  | 'graceEndsAt'
  | 'pendingEffectiveAt';
type StoredCorporateSubscription = Omit<
  PlatformSubscriptionSnapshot,
  DateField
> & {
  [Field in DateField]: PlatformSubscriptionSnapshot[Field] extends Date
    ? string
    : string | null;
} & { trialStartsAt: string | null };

export interface CorporateOrganizationRecord {
  id: string;
  displayName: string;
  legalName: string | null;
  tradeName: string | null;
  document: { type: string | null; number: string } | null;
  primarySegment: string;
  operationalStatus: string;
  purgeBlocked: boolean;
  registeredAt: string;
  updatedAt: string;
  unitCount: number;
  userCount: number;
  subscription: StoredCorporateSubscription | null;
}

export interface CorporateOrganizationDetailRecord extends CorporateOrganizationRecord {
  administrativeContact: { email: string | null; phone: string | null } | null;
  owner: { id: string; displayName: string } | null;
  activeUserCount: number;
  units: {
    id: string;
    legalName: string;
    tradeName: string | null;
    isPrimary: boolean;
    status: string;
    city: string;
    stateCode: string | null;
  }[];
}

export interface CorporateOrganizationPage {
  items: CorporateOrganizationRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CorporateAuditReference {
  technicalPrincipalId: string;
  declaredNexusAdministratorId?: string;
  correlationId: string;
}

export type CorporateMetadataUpdate =
  | {
      result: 'CONFIRMED' | 'NO_CHANGE';
      updatedAt: string;
      changedFields: string[];
    }
  | {
      result: 'NOT_FOUND' | 'VERSION_CONFLICT';
      updatedAt: null;
      changedFields: [];
    };

function nullableDate(value: string | null) {
  return value === null ? null : new Date(value);
}

export function projectCorporateOrganization<
  T extends CorporateOrganizationRecord,
>(record: T, now: Date) {
  const { subscription, purgeBlocked, ...organization } = record;
  const effective = projectPlatformSubscription(
    subscription
      ? {
          ...subscription,
          billingAnchorAt: new Date(subscription.billingAnchorAt),
          currentPeriodStart: new Date(subscription.currentPeriodStart),
          currentPeriodEnd: new Date(subscription.currentPeriodEnd),
          trialEndsAt: nullableDate(subscription.trialEndsAt),
          graceStartsAt: nullableDate(subscription.graceStartsAt),
          graceEndsAt: nullableDate(subscription.graceEndsAt),
          pendingEffectiveAt: nullableDate(subscription.pendingEffectiveAt),
        }
      : undefined,
    now,
  );
  return {
    ...organization,
    operational: isOrganizationOperational(
      organization.operationalStatus,
      purgeBlocked,
    ),
    subscription: {
      source: effective.source,
      status: subscription?.status ?? 'UNKNOWN',
      planCode: subscription?.planCode ?? null,
      effectiveStatus: effective.status,
      effectivePlanCode: effective.planCode,
      accessGranted: effective.accessGranted,
      billingInterval: effective.billingInterval,
      currentPeriodStart: effective.currentPeriodStart,
      currentPeriodEnd: effective.currentPeriodEnd,
      trialStartsAt: nullableDate(subscription?.trialStartsAt ?? null),
      trialEndsAt: effective.trialEndsAt,
    },
  };
}
