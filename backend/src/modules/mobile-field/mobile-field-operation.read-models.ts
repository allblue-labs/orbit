import type { OperationStatus } from '../../contracts';
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
  /**
   * Se este ator pode registrar material agora.
   *
   * Exigia `inventory.manage` — a permissão de almoxarifado —, e por isso
   * respondia `false` para o técnico que só executa. A etapa do roteiro então
   * dizia que "este atendimento não prevê registro de materiais", o que era
   * verdade sobre a permissão e mentira sobre o atendimento.
   *
   * Agora vale para qualquer um dos dois caminhos: item de catálogo (move
   * saldo, exige `inventory.manage`) ou material avulso (não move saldo, exige
   * `operations.update`).
   */
  enabled: boolean;
  allowedActions: readonly 'REGISTER_MATERIAL'[];
  requiresAvailableStock: true;
  idempotencyRequired: true;
  /**
   * Se este ator pode consumir do catálogo — e portanto do estoque.
   *
   * Separado de `enabled` porque a etapa precisa saber **qual** dos dois
   * caminhos oferecer: sem isto, ela mostraria a busca no catálogo para quem o
   * servidor recusaria, depois de a pessoa ter escolhido o produto.
   */
  catalogEnabled: boolean;
  /** Se este ator pode descrever um material avulso. */
  freeFormEnabled: boolean;
}

/**
 * Um material do atendimento.
 *
 * `PLANNED` é o que quem abriu a ordem previu; `APPLIED` é o que foi registrado
 * em campo. A etapa de materiais mostra os dois, e a diferença entre eles é
 * exatamente o que o técnico precisa conferir antes de concluir.
 */
export interface FieldOperationMaterialReadModel {
  id: string;
  origin: 'PLANNED' | 'APPLIED';
  description: string;
  unit: string;
  quantity: string;
  notes: string | null;
  /** Veio do catálogo — e então moveu saldo. `null` é material avulso. */
  catalogItemId: string | null;
  registeredBy: { id: string; name: string } | null;
  registeredAt: string | null;
}

export interface FieldOperationEvidencePolicyReadModel {
  /**
   * Se este ator pode anexar aqui, agora.
   *
   * Era o literal `false` — o contrato afirmava que **ninguém** anexa, e a
   * etapa de evidências do roteiro não tinha de onde tirar outra resposta.
   * Quem decide é a autoridade de evidências, a mesma que o upload consulta.
   */
  uploadEnabled: boolean;
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
  /**
   * Previstos e aplicados, na mesma lista, com a origem distinguindo.
   *
   * A etapa de materiais não tinha nada a mostrar: o contrato publicava só a
   * política — dois booleanos — e o conteúdo da etapa eram dois botões. Quem
   * abria não sabia o que havia sido previsto nem o que já tinha registrado.
   */
  materials: readonly FieldOperationMaterialReadModel[];
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
