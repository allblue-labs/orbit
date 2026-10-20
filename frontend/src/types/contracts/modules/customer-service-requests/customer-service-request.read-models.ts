/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

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

export type CustomerServiceRequestActionReadModel =
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
  asset: CustomerServiceRequestAssetReadModel | null;
  submittedAt: string;
  updatedAt: string;
  version: number;
  allowedActions: CustomerServiceRequestActionReadModel[];
}

export interface CustomerServiceRequestDetailsReadModel extends CustomerServiceRequestListItemReadModel {
  description: string;
  customer: { id: string; name: string };
  businessUnit: { id: string; name: string } | null;
  assignedTo: { id: string; displayName: string } | null;
  convertedOperation: { id: string; code: string; status: string } | null;
  timeline: CustomerServiceRequestTimelineItemReadModel[];
  closedAt: string | null;
  cancelledAt: string | null;
}

export interface CustomerServiceRequestPageReadModel {
  data: CustomerServiceRequestListItemReadModel[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}
