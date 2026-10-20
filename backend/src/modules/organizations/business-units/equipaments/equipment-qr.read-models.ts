/** Additive public contracts shared verbatim with Next.js. */
export type EquipmentFieldAction =
  | 'VIEW_DETAILS'
  | 'START_SERVICE_ORDER'
  | 'EXECUTE_PMOC'
  | 'ADD_TO_RVT'
  | 'VIEW_HISTORY';

export interface EquipmentQrSummaryReadModel {
  qrAvailable: boolean;
  status: string;
  createdAt: Date;
  lastRotatedAt: Date | null;
}

export interface EquipmentFieldCustomerReadModel {
  id: string;
  name: string;
  contact: { name: string; phone: string | null } | null;
}

export interface EquipmentPmocContextReadModel {
  planId: string;
  planName: string;
  cycleId: string | null;
  dueOn: Date | null;
  eligible: boolean;
  blockedReason: string | null;
}

export interface EquipmentFieldDetailsReadModel {
  id: string;
  code: string;
  name: string;
  type: string;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  status: string;
  customer: EquipmentFieldCustomerReadModel | null;
  serviceLocation: string | null;
  sector: string | null;
  lastService: { date: Date; type: string; status: string } | null;
  nextMaintenance: Date | null;
  pmocExecutableContexts: EquipmentPmocContextReadModel[];
  allowedActions: EquipmentFieldAction[];
  availability: { active: boolean; rvtExecutionIds: string[] };
}

export interface EquipmentServiceOrderPreparationReadModel {
  equipment: { id: string; code: string; name: string; type: string };
  customer: { id: string; name: string } | null;
  businessUnitId: string;
  address: unknown;
  serviceLocation: string | null;
  contact: { name: string; phone: string | null; email: string | null } | null;
  /** Preparation never creates an Operation. */
  operationCreated: false;
}
