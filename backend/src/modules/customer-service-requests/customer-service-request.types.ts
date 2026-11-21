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

/** Quão urgente o cliente diz que é. Sem escolha, NORMAL. */
export const CUSTOMER_SERVICE_REQUEST_URGENCIES = [
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT',
] as const;
export type CustomerServiceRequestUrgency =
  (typeof CUSTOMER_SERVICE_REQUEST_URGENCIES)[number];

/** Como o equipamento está agora — o técnico decide o que levar por isso. */
export const CUSTOMER_SERVICE_REQUEST_EQUIPMENT_CONDITIONS = [
  'STOPPED',
  'MALFUNCTIONING',
  'WORKING',
] as const;
export type CustomerServiceRequestEquipmentCondition =
  (typeof CUSTOMER_SERVICE_REQUEST_EQUIPMENT_CONDITIONS)[number];

/** Os detalhes opcionais que o cliente informa ao abrir. */
export interface CustomerServiceRequestDetails {
  equipmentCondition?: CustomerServiceRequestEquipmentCondition;
  siteLocation?: string;
  availability?: string;
  contactName?: string;
  contactPhone?: string;
}

export type CustomerServiceRequestAction =
  | 'EDIT'
  | 'REPLY'
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
