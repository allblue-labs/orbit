export const CUSTOMER_SERVICE_REQUEST_CATEGORIES = [
  'MAINTENANCE',
  'EQUIPMENT_PROBLEM',
  'SERVICE_REQUEST',
  'DOCUMENT_REQUEST',
  'QUESTION',
  'OTHER',
] as const;

export type CustomerServiceRequestCategory =
  (typeof CUSTOMER_SERVICE_REQUEST_CATEGORIES)[number];

export const CUSTOMER_SERVICE_REQUEST_STATUSES = [
  'OPEN',
  'IN_TRIAGE',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'RESOLVED',
  'REJECTED',
  'CANCELLED',
] as const;

export type CustomerServiceRequestStatus =
  (typeof CUSTOMER_SERVICE_REQUEST_STATUSES)[number];

export type CustomerServiceRequestAction =
  | 'CANCEL'
  | 'TRIAGE'
  | 'ASSIGN'
  | 'MARK_IN_PROGRESS'
  | 'WAIT_FOR_CUSTOMER'
  | 'RESOLVE'
  | 'REJECT'
  | 'ADD_PUBLIC_RESPONSE'
  | 'ADD_INTERNAL_NOTE'
  | 'CREATE_OPERATION';

export interface InternalCustomerServiceRequestActor {
  actorId: string;
  organizationId: string;
  businessUnitIds: readonly string[];
  permissions: readonly string[];
}
