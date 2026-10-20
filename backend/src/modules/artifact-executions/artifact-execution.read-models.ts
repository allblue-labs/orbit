import type {
  ArtifactLayoutReadModel,
  ArtifactSectionReadModel,
  ArtifactSignatureSlotReadModel,
} from '../artifact-templates/artifact-template.read-models';

export interface ArtifactSnapshotReadModel {
  id: string;
  templateId: string;
  templateVersion: number;
  templateKey: string;
  templateName: string;
  artifactType: string;
  segment: string | null;
  metadata: Readonly<Record<string, unknown>>;
  sections: readonly ArtifactSectionReadModel[];
  signatureSlots: readonly ArtifactSignatureSlotReadModel[];
  layout: ArtifactLayoutReadModel;
  structureHash: string;
  createdAt: string;
}

export interface ArtifactExecutionResponseReadModel {
  id: string;
  sectionId: string;
  fieldId: string;
  value: unknown;
  valueType: string;
  unit: string | null;
  validations: readonly Record<string, unknown>[];
  provenance: string;
  notes: string | null;
  answeredById: string | null;
  answeredAt: string;
  updatedAt: string;
}

export interface ArtifactExecutionAttachmentReadModel {
  id: string;
  responseId: string | null;
  sectionId: string | null;
  kind: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  storageKey: string;
  checksum: string | null;
  metadata: Readonly<Record<string, unknown>>;
  uploadedById: string;
  createdAt: string;
}

export interface ArtifactExecutionSignatureReadModel {
  id: string;
  slotId: string;
  signerRole: string;
  signedAs: 'FIELD_TECHNICIAN' | 'TECHNICAL_RESPONSIBLE' | 'CUSTOMER' | null;
  userId: string | null;
  signerName: string;
  signerDocument: string | null;
  signatureHash: string;
  signatureAssetHash: string | null;
  professionalRole: string | null;
  professionalCredential: {
    type: string;
    registrationNumber: string;
    region: string | null;
  } | null;
  capturedAt: string | null;
  consentText: string | null;
  geolocation: Readonly<Record<string, unknown>> | null;
  signedAt: string;
  revokedAt: string | null;
}

export interface ArtifactExecutionInsightReadModel {
  id: string;
  kind: string;
  severity: string;
  source: string;
  title: string;
  description: string;
  payload: Readonly<Record<string, unknown>>;
  resolvedAt: string | null;
  createdAt: string;
}

export interface ArtifactExecutionProgressReadModel {
  percentage: number;
  totalFields: number;
  answeredFields: number;
  requiredFields: number;
  requiredPending: number;
  totalSections: number;
  completedSections: number;
  requiredSignatures: number;
  pendingSignatures: number;
  canComplete: boolean;
}

/**
 * Estado da renderização do artefato (PDF/HTML).
 *
 * Publicado desde já para que os clientes suportem o ciclo completo sem
 * mudança de contrato quando o motor de renderização existir. Enquanto não
 * existe, o backend responde sempre `NOT_RENDERED` — é a declaração honesta de
 * "nada foi renderizado", e não um valor de espera.
 */
export const ARTIFACT_RENDER_STATUSES = [
  'NOT_RENDERED',
  'PENDING',
  'RENDERING',
  'READY',
  'FAILED',
] as const;
export type ArtifactRenderStatus = (typeof ARTIFACT_RENDER_STATUSES)[number];

export interface ArtifactExecutionListItemReadModel {
  id: string;
  organizationId: string;
  businessUnitId: string;
  operationId: string | null;
  customerId: string | null;
  assetId: string | null;
  templateId: string;
  snapshotId: string;
  responsibleUserId: string | null;
  code: string;
  title: string;
  status: string;
  renderStatus: ArtifactRenderStatus;
  progress: number;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArtifactExecutionReadModel extends ArtifactExecutionListItemReadModel {
  createdById: string;
  pausedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  archivedAt: string | null;
  notes: string | null;
  context: Readonly<Record<string, unknown>>;
  team: readonly { userId: string; role: string; assignedAt: string }[];
  snapshot: ArtifactSnapshotReadModel;
  responses: readonly ArtifactExecutionResponseReadModel[];
  attachments: readonly ArtifactExecutionAttachmentReadModel[];
  signatures: readonly ArtifactExecutionSignatureReadModel[];
  insights: readonly ArtifactExecutionInsightReadModel[];
  progressDetails: ArtifactExecutionProgressReadModel;
}

export interface ArtifactExecutionListReadModel {
  data: readonly ArtifactExecutionListItemReadModel[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}
