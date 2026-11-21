export interface CustomerPortalOrganizationReadModel {
  id: string;
  slug: string;
  displayName: string;
}

export interface CustomerPortalCustomerReadModel {
  id: string;
  displayName: string;
}

export interface CustomerPortalIdentityReadModel {
  id: string;
  displayName: string;
  email: string;
  status: 'invited' | 'active' | 'disabled';
  contactId: string | null;
}

export interface CustomerPortalMeReadModel {
  actorType: 'CUSTOMER_PORTAL';
  identity: CustomerPortalIdentityReadModel;
  organization: CustomerPortalOrganizationReadModel;
  customer: CustomerPortalCustomerReadModel;
  sessionId: string;
  /** Senha temporária ainda não trocada: o app só libera a troca. */
  mustChangePassword: boolean;
}

/** O acesso do cliente como o owner o vê. Nunca carrega senha. */
export interface CustomerPortalAccessIdentityReadModel {
  id: string;
  email: string;
  displayName: string;
  status: 'invited' | 'active' | 'disabled';
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface CustomerPortalAccessReadModel {
  /** O domínio que o endereço vai ter — o mesmo da equipe. */
  domain: string | null;
  /** Parte local sugerida a partir do nome do cliente. */
  suggestedLocalPart: string;
  /** O acesso atual: o ativo, ou o último desativado. `null` se nunca houve. */
  identity: CustomerPortalAccessIdentityReadModel | null;
}

/** Resposta de criar acesso ou gerar nova senha: a senha aparece **uma vez**. */
export interface CustomerPortalAccessCredentialsReadModel {
  identity: CustomerPortalAccessIdentityReadModel;
  temporaryPassword: string;
}

export interface CustomerPortalMediaReadModel {
  available: boolean;
  url: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
}

export interface CustomerPortalProfileReadModel {
  avatar: CustomerPortalMediaReadModel;
  signature: CustomerPortalMediaReadModel;
}

export interface CustomerPortalSessionReadModel {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  me: CustomerPortalMeReadModel;
}

export interface CustomerPortalInvitationReadModel {
  id: string;
  identityId: string;
  customerId: string;
  displayName: string;
  email: string;
  expiresAt: string;
  status: 'invited';
}

export interface PortalMessageReadModel {
  message: string;
}

export interface CustomerPortalStatusReadModel {
  code: string;
  label: string;
}

export interface CustomerPortalBusinessUnitReadModel {
  id: string;
  displayName: string;
  timezone: string;
}

export interface CustomerPortalPaginationReadModel {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface CustomerPortalPageReadModel<T> {
  data: readonly T[];
  meta: CustomerPortalPaginationReadModel;
}

export interface CustomerPortalDashboardReadModel {
  recentOperations: number;
  assets: number;
  activePmocPlans: number;
  upcomingVisits: number;
  availableDocuments: number;
}

export interface CustomerPortalOperationListItemReadModel {
  id: string;
  code: string;
  type: string;
  title: string;
  status: CustomerPortalStatusReadModel;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  completedAt: string | null;
  businessUnit: CustomerPortalBusinessUnitReadModel;
  assets: readonly { id: string; displayName: string }[];
  responsibleTechnician: { displayName: string } | null;
  location: string | null;
  documentAvailable: boolean;
  /** O documento mais recente do atendimento — o id que `documents/:id/access` aceita. */
  documentId: string | null;
}

export interface CustomerPortalOperationTimelineItemReadModel {
  id: string;
  event: string;
  description: string;
  occurredAt: string;
}

export interface CustomerPortalOperationDetailsReadModel extends CustomerPortalOperationListItemReadModel {
  description: string | null;
  startedAt: string | null;
  timeline: readonly CustomerPortalOperationTimelineItemReadModel[];
}

export interface CustomerPortalAssetListItemReadModel {
  id: string;
  displayName: string;
  category: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  identifier: string | null;
  location: string | null;
  status: CustomerPortalStatusReadModel;
  businessUnit: CustomerPortalBusinessUnitReadModel;
}

export interface CustomerPortalAssetDetailsReadModel extends CustomerPortalAssetListItemReadModel {
  installedOn: string | null;
  warrantyUntil: string | null;
  related: {
    operations: number;
    pmocPlans: number;
    rvtConfigurations: number;
    documents: number;
  };
}

export interface CustomerPortalPmocListItemReadModel {
  id: string;
  code: string;
  name: string;
  status: CustomerPortalStatusReadModel;
  compliance: CustomerPortalStatusReadModel;
  startsOn: string;
  endsOn: string | null;
  nextDueOn: string | null;
  frequency: string;
  coveredAssets: number;
  businessUnit: CustomerPortalBusinessUnitReadModel;
}

export interface CustomerPortalPmocCycleReadModel {
  id: string;
  sequence: number;
  dueOn: string;
  status: CustomerPortalStatusReadModel;
  performedAt: string | null;
  documentAvailable: boolean;
}

export interface CustomerPortalPmocDetailsReadModel extends CustomerPortalPmocListItemReadModel {
  cycles: readonly CustomerPortalPmocCycleReadModel[];
}

export interface CustomerPortalRvtListItemReadModel {
  id: string;
  code: string;
  name: string;
  visitType: string;
  schedule: string;
  status: CustomerPortalStatusReadModel;
  coverageStart: string;
  coverageEnd: string | null;
  timezone: string;
  plannedVisits: number;
  completedVisits: number;
  nextVisitAt: string | null;
}

export interface CustomerPortalRvtVisitReadModel {
  id: string;
  sequence: number;
  scheduledAt: string | null;
  localDate: string | null;
  status: CustomerPortalStatusReadModel;
  performedAt: string | null;
  documentAvailable: boolean;
}

export interface CustomerPortalRvtDetailsReadModel extends CustomerPortalRvtListItemReadModel {
  visits: readonly CustomerPortalRvtVisitReadModel[];
}

export interface CustomerPortalDocumentReadModel {
  id: string;
  fileName: string;
  /** O título do documento como foi emitido — "Orçamento ORC-0042 — Preventiva". */
  title: string;
  code: string;
  category: 'service' | 'pmoc' | 'quote' | 'receipt';
  categoryLabel: string;
  /** O atendimento de origem, quando há. */
  operationId: string | null;
  type: string;
  source: string;
  issuedAt: string;
  availability: CustomerPortalStatusReadModel;
  sizeBytes: number;
  mimeType: string;
}

export interface CustomerPortalDocumentAccessReadModel {
  url: string;
  expiresAt: string;
  method: 'GET';
}
