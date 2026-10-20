/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

export const FIELD_EVIDENCE_TARGETS = [
  'OPERATION',
  'PMOC_EQUIPMENT_EXECUTION',
  'RVT_EXECUTION',
] as const;
export const FIELD_EVIDENCE_CATEGORIES = [
  'BEFORE',
  'AFTER',
  'GENERAL',
  'EQUIPMENT',
  'DEFECT',
  'MEASUREMENT',
] as const;
export const FIELD_EVIDENCE_SOURCES = ['CAMERA', 'GALLERY', 'FILE'] as const;

export type FieldEvidenceTarget = (typeof FIELD_EVIDENCE_TARGETS)[number];
export type EvidenceCategory = (typeof FIELD_EVIDENCE_CATEGORIES)[number];
export type EvidenceSource = (typeof FIELD_EVIDENCE_SOURCES)[number];
export type EvidenceUploadStatus =
  'PENDING_UPLOAD' | 'UPLOADED' | 'FINALIZED' | 'FAILED' | 'EXPIRED';

export interface EvidenceUploadIntentReadModel {
  uploadId: string;
  uploadUrl: string | null;
  method: 'PUT' | null;
  requiredHeaders: Readonly<Record<string, string>>;
  expiresAt: string;
  maxSize: number;
  localMediaId: string | null;
  status: EvidenceUploadStatus;
}

export interface FieldEvidenceReadModel {
  id: string;
  target: { type: FieldEvidenceTarget; id: string };
  category: EvidenceCategory;
  filename: string;
  mimeType: string;
  sizeBytes: string;
  sha256: string;
  capturedAt: string | null;
  uploadedAt: string;
  capturedBy: { id: string; name: string };
  source: EvidenceSource;
  localMediaId: string | null;
  previewAvailable: boolean;
  downloadAvailable: true;
}

export interface EvidenceAccessReadModel {
  evidenceId: string;
  operation: 'preview' | 'download';
  url: string;
  expiresAt: string;
  requiredHeaders: Readonly<Record<string, string>>;
}

export interface EvidencePolicyReadModel {
  acceptedMimeTypes: readonly string[];
  imageMaxBytes: number;
  documentMaxBytes: number;
  maximumFiles: number;
  pendingUploadTtlHours: number;
}
