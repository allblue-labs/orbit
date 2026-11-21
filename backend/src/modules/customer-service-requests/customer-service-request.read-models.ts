export type CustomerServiceRequestCategoryReadModel =
  | 'MAINTENANCE'
  | 'EQUIPMENT_PROBLEM'
  | 'SERVICE_REQUEST'
  | 'DOCUMENT_REQUEST'
  | 'QUESTION'
  | 'OTHER';

export type CustomerServiceRequestStatusReadModel =
  | 'OPEN'
  | 'IN_TRIAGE'
  | 'IN_PROGRESS'
  | 'WAITING_CUSTOMER'
  | 'RESOLVED'
  | 'REJECTED'
  | 'CANCELLED';

export type CustomerServiceRequestUrgencyReadModel =
  'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export interface CustomerServiceRequestDetailsInfoReadModel {
  equipmentCondition: {
    code: 'STOPPED' | 'MALFUNCTIONING' | 'WORKING';
    label: string;
  } | null;
  siteLocation: string | null;
  availability: string | null;
  contactName: string | null;
  contactPhone: string | null;
}

export type CustomerServiceRequestActionReadModel =
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

export interface CustomerServiceRequestLabelReadModel<T extends string> {
  code: T;
  label: string;
}

export interface CustomerServiceRequestAssetReadModel {
  id: string;
  name: string;
  identifier: string | null;
}

export interface CustomerServiceRequestTimelineItemReadModel {
  id: string;
  type: string;
  visibility: 'PORTAL' | 'INTERNAL';
  actor: { type: string; displayName: string };
  message: string | null;
  statusChange: {
    from: CustomerServiceRequestStatusReadModel | null;
    to: CustomerServiceRequestStatusReadModel | null;
  } | null;
  createdAt: string;
}

export interface CustomerServiceRequestListItemReadModel {
  id: string;
  code: string;
  category: CustomerServiceRequestLabelReadModel<CustomerServiceRequestCategoryReadModel>;
  subject: string;
  status: CustomerServiceRequestLabelReadModel<CustomerServiceRequestStatusReadModel>;
  urgency: CustomerServiceRequestLabelReadModel<CustomerServiceRequestUrgencyReadModel>;
  asset: CustomerServiceRequestAssetReadModel | null;
  /** Quem abriu — a lista da equipe mostra; a do cliente é sempre ele mesmo. */
  customerName: string | null;
  assignedTo: { id: string; displayName: string } | null;
  submittedAt: string;
  updatedAt: string;
  version: number;
  allowedActions: CustomerServiceRequestActionReadModel[];
}

export interface CustomerServiceRequestDetailsReadModel extends CustomerServiceRequestListItemReadModel {
  description: string;
  details: CustomerServiceRequestDetailsInfoReadModel;
  /** Quem abriu pelo portal. */
  requester: string | null;
  customer: { id: string; name: string };
  businessUnit: { id: string; name: string } | null;
  convertedOperation: { id: string; code: string; status: string } | null;
  timeline: CustomerServiceRequestTimelineItemReadModel[];
  closedAt: string | null;
  cancelledAt: string | null;
}

export interface CustomerServiceRequestPageReadModel {
  data: CustomerServiceRequestListItemReadModel[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
