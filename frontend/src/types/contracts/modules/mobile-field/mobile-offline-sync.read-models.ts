/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

import type {
  MobileFieldContextReadModel,
  MobileWorkItemReadModel,
} from './mobile-field.read-models';
import type { FieldOperationExecutionPreparationReadModel } from './mobile-field-operation.read-models';
export type OfflineCommandType =
  | 'OPERATION_START'
  | 'OPERATION_CHECKLIST_UPDATE'
  | 'OPERATION_ADD_NOTE'
  | 'OPERATION_ADD_MATERIAL'
  | 'OPERATION_COMPLETE'
  | 'CUSTOMER_ACKNOWLEDGEMENT';

export type OfflineCommandResultStatus =
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'CONFLICT'
  | 'REJECTED'
  | 'RETRYABLE_ERROR'
  | 'BLOCKED';
export type OfflineConflictCode =
  | 'VERSION_CONFLICT'
  | 'STATE_CONFLICT'
  | 'AUTHORIZATION_CHANGED'
  | 'ASSIGNMENT_CHANGED'
  | 'RESOURCE_REMOVED'
  | 'CHECKLIST_CHANGED'
  | 'MATERIAL_STOCK_CONFLICT'
  | 'ACKNOWLEDGEMENT_STALE'
  | 'IDEMPOTENCY_MISMATCH';

export interface OfflineCommandResultReadModel {
  commandId: string;
  commandType: OfflineCommandType;
  status: OfflineCommandResultStatus;
  serverVersion: string | null;
  authoritativeResourceRef: string | null;
  conflict: {
    code: OfflineConflictCode;
    message: string;
    refreshRequired: boolean;
  } | null;
  error: { code: string; message: string; retryable: boolean } | null;
}

export interface FieldPackageReadModel {
  packageId: string;
  generatedAt: string;
  expiresAt: string | null;
  serverCheckpoint: string;
  kind: 'OPERATION' | 'PMOC' | 'RVT';
  workItem: MobileWorkItemReadModel;
  context: MobileFieldContextReadModel;
  operation: FieldOperationExecutionPreparationReadModel | null;
  pmoc: PmocFieldPackageContextReadModel | null;
  rvt: RvtFieldPackageContextReadModel | null;
  allowedActionsAtGeneration: readonly string[];
  versionTokens: Record<string, string>;
  cachePolicy: { sensitive: true; purgeOnLogout: true; authoritative: false };
  mediaPolicy: { blobsIncluded: false; localMediaReferencesAccepted: false };
}

export interface PmocFieldPackageContextReadModel {
  cycle: { id: string; status: string; dueOn: string; version: string };
  equipmentExecution: {
    id: string;
    status: string;
    procedureSnapshot: unknown;
    responsible: { id: string; name: string };
  } | null;
  procedure: unknown;
  technicalResponsible: { required: boolean; userId: string | null };
  evidencePolicy: {
    acceptedKinds: readonly ['PHOTO', 'VIDEO', 'DOCUMENT'];
    blobsIncluded: false;
  };
}

export interface RvtFieldPackageContextReadModel {
  occurrence: {
    id: string;
    status: string;
    scheduledFor: string | null;
    version: string;
  };
  execution: {
    id: string;
    status: string;
    procedureSnapshot: unknown;
    responsible: { id: string; name: string };
  } | null;
  procedure: unknown;
  technicalResponsible: { required: boolean; userId: string | null };
  customerAcknowledgementPolicy: { allowed: true; signatureOptional: true };
  evidencePolicy: {
    acceptedKinds: readonly ['PHOTO', 'VIDEO', 'DOCUMENT'];
    blobsIncluded: false;
  };
}

export interface MobileSyncPushResponseReadModel {
  results: readonly OfflineCommandResultReadModel[];
  serverTime: string;
  nextRecommendedAction: 'PULL';
}
export interface MobileSyncPullResponseReadModel {
  status: 'DELTA' | 'FULL_RESYNC_REQUIRED';
  changes: readonly {
    sequence: string;
    resourceType: string;
    resourceId: string;
    changeType: 'UPSERTED' | 'REMOVED' | 'REVOKED' | 'OUT_OF_SCOPE';
    version: string | null;
    snapshot: MobileWorkItemReadModel | null;
  }[];
  tombstones: readonly { resourceId: string; reason: 'OUT_OF_SCOPE' }[];
  nextCursor: string | null;
  hasMore: boolean;
  purgeRequired: boolean;
}
