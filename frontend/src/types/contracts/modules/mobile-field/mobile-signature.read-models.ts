/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

export type MobileProfessionalRole =
  'FIELD_TECHNICIAN' | 'TECHNICAL_RESPONSIBLE';

export interface MobileSignatureStatusReadModel {
  signatureAvailable: boolean;
  version: number | null;
  updatedAt: string | null;
  roles: readonly MobileProfessionalRole[];
  preview: MobileSignaturePreviewReadModel | null;
}

export interface MobileSignaturePreviewReadModel {
  url: string;
  expiresAt: string;
  requiredHeaders: Readonly<Record<string, string>>;
  mimeType: string;
  sizeBytes: string;
  sha256: string;
}

export interface MobileSignatureUploadResultReadModel extends MobileSignatureStatusReadModel {
  replacedVersion: number | null;
}

export interface MobileSignatureUploadReservationReadModel {
  fileId: string;
  upload: {
    url: string;
    expiresAt: string;
    method: 'PUT';
    requiredHeaders: Readonly<Record<string, string>>;
  };
}

export interface ProfessionalSignatureRequirementReadModel {
  required: boolean;
  available: boolean;
  role: MobileProfessionalRole | null;
  eligible: boolean;
  blockedReason: 'FIELD_TECHNICIAN_SIGNATURE_MISSING' | null;
  message: string | null;
}

export interface CustomerAcknowledgementPreparationReadModel {
  executionType: 'OPERATION' | 'RVT';
  executionId: string;
  customer: { id: string; name: string } | null;
  equipment: readonly { id: string; code: string; name: string }[];
  serviceSummary: string;
  performedAt: string | null;
  signerPolicy: {
    acknowledgementAllowed: true;
    signatureRequired: false;
    signatureOptional: true;
  };
  existingAcknowledgement: {
    signerName: string;
    acknowledgedAt: string;
    hasSignature: boolean;
  } | null;
  contentVersion: string;
  contentHash: string;
}

export interface CustomerAcknowledgementResultReadModel {
  id: string;
  executionType: 'OPERATION' | 'RVT';
  executionId: string;
  signerName: string;
  hasSignature: boolean;
  acknowledgedAt: string;
  contentVersion: string;
  contentHash: string;
  idempotentReplay: boolean;
}
