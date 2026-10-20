/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

import type { OperationStatus } from '../..';
import type {
  MobileArtifactSummaryReadModel,
  MobileCustomerSummaryReadModel,
  MobileEquipmentSummaryReadModel,
  MobileFieldAction,
  MobilePartySummaryReadModel,
} from './mobile-field.read-models';
import type { ProfessionalSignatureRequirementReadModel } from './mobile-signature.read-models';

export type FieldOperationAllowedAction =
  MobileFieldAction | 'UPDATE_CHECKLIST' | 'ADD_NOTE' | 'REGISTER_MATERIAL';

export interface FieldOperationChecklistReadModel {
  id: string;
  name: string;
  status: string;
  progress: number;
  version: string;
  items: readonly {
    id: string;
    label: string;
    type: string;
    required: boolean;
    options: readonly string[];
    answer: unknown;
  }[];
  notes: string | null;
}

export interface FieldOperationMaterialPolicyReadModel {
  enabled: boolean;
  allowedActions: readonly 'REGISTER_MATERIAL'[];
  requiresAvailableStock: true;
  idempotencyRequired: true;
}

export interface FieldOperationEvidencePolicyReadModel {
  uploadEnabled: false;
  acceptedKinds: readonly ['PHOTO', 'VIDEO', 'DOCUMENT'];
  base64Accepted: false;
}

export interface FieldOperationExecutionPreparationReadModel {
  operation: {
    id: string;
    code: string;
    /**
     * `OS-000087` — o número da ordem de serviço, como o documento o imprime.
     *
     * É o que o técnico lê em voz alta para o cliente e o que o cliente anota.
     * `code` é a convenção interna de quem criou a operação, e nulo aqui é o
     * normal de uma operação que não é ordem de serviço — PMOC e RVT têm as
     * contagens delas.
     */
    serviceOrderCode: string | null;
    title: string;
    description: string | null;
    status: OperationStatus;
    priority: string;
    scheduledFor: string | null;
    startedAt: string | null;
    completedAt: string | null;
    startedBy: MobilePartySummaryReadModel | null;
    completedBy: MobilePartySummaryReadModel | null;
  };
  customer: MobileCustomerSummaryReadModel | null;
  serviceLocation: unknown;
  equipment: readonly MobileEquipmentSummaryReadModel[];
  responsibleFieldTechnician: MobilePartySummaryReadModel | null;
  auxiliaryTechnicians: readonly MobilePartySummaryReadModel[];
  checklist: readonly FieldOperationChecklistReadModel[];
  materialPolicy: FieldOperationMaterialPolicyReadModel;
  evidencePolicy: FieldOperationEvidencePolicyReadModel;
  artifactPolicy: {
    eligibleAfterCompletion: true;
    synchronousGeneration: false;
    artifacts: readonly MobileArtifactSummaryReadModel[];
  };
  professionalSignature: ProfessionalSignatureRequirementReadModel;
  allowedTransitions: readonly OperationStatus[];
  allowedActions: readonly FieldOperationAllowedAction[];
  primaryAction: FieldOperationAllowedAction | null;
  version: string;
  executionEligibility: { eligible: boolean; blockers: readonly string[] };
}

export interface FieldOperationCommandResultReadModel {
  operationId: string;
  status: OperationStatus;
  version: string;
  startedBy: MobilePartySummaryReadModel | null;
  startedAt: string | null;
  completedBy: MobilePartySummaryReadModel | null;
  completedAt: string | null;
  allowedActions: readonly FieldOperationAllowedAction[];
  idempotentReplay: boolean;
}

export interface FieldOperationMaterialResultReadModel {
  movementId: string;
  operationId: string;
  catalogItemId: string;
  quantity: string;
  balanceAfter: string;
  idempotentReplay: boolean;
}

export interface FieldOperationTimelineEntryReadModel {
  id: string;
  type: string;
  message: string;
  actor: MobilePartySummaryReadModel | null;
  occurredAt: string;
  data: Record<string, unknown>;
}

export interface FieldOperationTimelineReadModel {
  data: readonly FieldOperationTimelineEntryReadModel[];
  meta: { limit: number; nextCursor: string | null; hasNextPage: boolean };
}
