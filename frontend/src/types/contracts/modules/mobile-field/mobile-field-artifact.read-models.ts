/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

export const FIELD_ARTIFACT_SOURCE_TYPES = [
  'OPERATION',
  'RVT_EXECUTION',
  'PMOC_EQUIPMENT_EXECUTION',
] as const;
export type FieldArtifactSourceType =
  (typeof FIELD_ARTIFACT_SOURCE_TYPES)[number];

export type FieldArtifactDocumentType = 'SERVICE_ORDER' | 'RVT' | 'PMOC';
export type FieldArtifactStatus =
  'NOT_PREPARED' | 'PREPARED' | 'PENDING' | 'RENDERING' | 'READY' | 'FAILED';
export type FieldArtifactAllowedAction =
  | 'PREPARE_DOCUMENT'
  | 'GENERATE_DOCUMENT'
  | 'VIEW_DOCUMENT'
  | 'DOWNLOAD_DOCUMENT';
export type FieldArtifactBlockedReason =
  | 'SOURCE_NOT_COMPLETED'
  | 'FIELD_TECHNICIAN_SIGNATURE_MISSING'
  | 'TECHNICAL_RESPONSIBLE_MISSING'
  | 'RT_SIGNATURE_MISSING'
  | 'ACKNOWLEDGEMENT_REQUIRED'
  | 'ACKNOWLEDGEMENT_STALE'
  | 'EVIDENCE_PENDING'
  | 'TEMPLATE_NOT_AVAILABLE'
  | 'NOT_AUTHORIZED';

export interface FieldArtifactEligibilityReadModel {
  eligible: boolean;
  blockedReasons: readonly FieldArtifactBlockedReason[];
}

export interface FieldArtifactReadModel {
  id: string;
  artifactExecutionId: string;
  sourceType: FieldArtifactSourceType;
  sourceId: string;
  documentType: FieldArtifactDocumentType;
  status: FieldArtifactStatus;
  snapshotVersion: number;
  snapshotHash: string;
  templateVersion: number;
  generatedAt: string | null;
  previewAvailable: boolean;
  downloadAvailable: boolean;
  allowedActions: readonly FieldArtifactAllowedAction[];
}

export interface FieldArtifactPreparationReadModel {
  sourceType: FieldArtifactSourceType;
  sourceId: string;
  documentType: FieldArtifactDocumentType;
  eligibility: FieldArtifactEligibilityReadModel;
  templateVersion: number | null;
  professionalSignatures: {
    fieldTechnician: boolean;
    technicalResponsibleRequired: boolean;
    technicalResponsible: boolean;
  };
  customerAcknowledgement: {
    required: boolean;
    available: boolean;
    valid: boolean;
  };
  evidenceSummary: { finalized: number; pending: number };
  snapshotVersion: number;
  existingArtifact: FieldArtifactReadModel | null;
  allowedActions: readonly FieldArtifactAllowedAction[];
}

export interface FieldArtifactDownloadReadModel {
  artifactId: string;
  operation: 'preview' | 'download';
  url: string;
  expiresAt: string;
  requiredHeaders: Readonly<Record<string, string>>;
}
