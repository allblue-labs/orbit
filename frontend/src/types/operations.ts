/**
 * Contratos do módulo Operations.
 *
 * Os **literais** (status, tipo, prioridade, ações de histórico) vêm dos
 * contratos sincronizados do backend e não são redeclarados.
 *
 * As formas públicas são sincronizadas dos Read Models do backend. Este
 * arquivo mantém aliases compatíveis para os componentes existentes.
 */
import type {
  OperationKind,
  OperationPriority,
  OperationStatus,
} from "./contracts";
import type {
  OperationAssignmentReadModel,
  OperationAttachmentReadModel,
  OperationBusinessUnitReadModel,
  OperationCustomerReadModel,
  OperationAssetReadModel,
  OperationChecklistReadModel,
  OperationDetailsReadModel,
  OperationHistoryReadModel,
  OperationListItemReadModel,
  OperationFieldAcknowledgementReadModel,
  OperationFieldEvidenceReadModel,
  OperationFieldRecordReadModel,
  OperationTimelineAttachmentReadModel,
  OperationTimelineReadModel,
  OperationUserReadModel,
} from "./contracts/modules/operations/operation.read-models";

export type OperationUserRef = OperationUserReadModel;
export type OperationAssignment = OperationAssignmentReadModel;
export type OperationAttachment = OperationAttachmentReadModel;
export type OperationTimelineAttachment = OperationTimelineAttachmentReadModel;
export type OperationHistoryEntry = OperationHistoryReadModel;
export type OperationTimeline = OperationTimelineReadModel;

/** O que o campo registrou: fotos e o aceite do cliente. */
export type OperationFieldRecord = OperationFieldRecordReadModel;
export type OperationFieldEvidence = OperationFieldEvidenceReadModel;
export type OperationFieldAcknowledgement =
  OperationFieldAcknowledgementReadModel;
export type OperationBusinessUnitRef = OperationBusinessUnitReadModel;
export type OperationCustomerRef = OperationCustomerReadModel;
export type OperationAssetRef = OperationAssetReadModel;
export type OperationChecklistSummary = OperationChecklistReadModel;
/**
 * A ordem de serviço como o **detalhe** a publica.
 *
 * Só ela traz `transitions`: a listagem é compacta de propósito no backend.
 * Tipar uma linha de lista como este tipo prometeria uma máquina de estados
 * que não vem no payload — e foi o que aconteceu até a PR-FE-01.
 */
export type Operation = OperationDetailsReadModel;

/** Uma linha da listagem. Traz `allowedActions`, não traz `transitions`. */
export type OperationListItem = OperationListItemReadModel;

/** Query de `GET /operations` (`OperationQueryDto`). */
export interface OperationQuery {
  search?: string;
  businessUnitId?: string;
  customerId?: string;
  assetId?: string;
  assignedUserId?: string;
  /**
   * Só o que está atribuído e esperando autorização.
   *
   * É a fila da aba Autorização. Recorte do servidor, não da página: com vinte por
   * página, contar no navegador diria "3 pendentes" numa organização com duzentas.
   */
  pendingAuthorization?: boolean;
  kind?: OperationKind;
  status?: OperationStatus;
  priority?: OperationPriority;
  scheduledFrom?: string;
  scheduledTo?: string;
  page?: number;
  limit?: number;
}

/**
 * `POST /operations` (`CreateOperationDto`).
 *
 * `businessUnitId`, `code`, `kind` e `title` são obrigatórios no DTO. Os
 * limites de tamanho são os do `class-validator`, replicados em
 * `OPERATION_LIMITS` para retorno imediato na tela — a recusa continua sendo
 * do servidor.
 */
export interface CreateOperationInput {
  businessUnitId: string;
  customerId?: string;
  /** Os equipamentos atendidos — era `assetId`, um só. */
  assetIds?: string[];
  /** Para onde o técnico vai: um endereço cadastrado do cliente. */
  customerAddressId?: string;
  /** O ponto exato dentro do endereço. */
  sector?: string;
  /**
   * O técnico em campo pode ver quanto este atendimento vale?
   *
   * Governa a visibilidade, não o número: o valor é o total do orçamento
   * vinculado. Omitido é `false` — liberar é um ato consciente.
   */
  amountVisibleInField?: boolean;
  code: string;
  kind: OperationKind;
  title: string;
  description?: string;
  priority?: OperationPriority;
  scheduledStart?: string;
  scheduledEnd?: string;

  /**
   * Quem executa, e quem acompanha.
   *
   * Os dois campos existem no `CreateOperationDto` desde sempre e nenhuma
   * tela os enviava: o atendimento nascia sem dono, e atribuir dependia de
   * abrir a operação depois. O formulário passa a oferecê-los.
   */
  responsibleFieldTechnicianId?: string;
  auxiliaryTechnicianIds?: string[];

  location?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

/** `PATCH /operations/:id` (`UpdateOperationDto` — `PartialType`). */
export type UpdateOperationInput = Partial<CreateOperationInput>;

/** Limites declarados pelo `class-validator` no `CreateOperationDto`. */
export const OPERATION_LIMITS = {
  codeMinLength: 2,
  codeMaxLength: 60,
  titleMinLength: 2,
  titleMaxLength: 220,
  statusReasonMaxLength: 500,
} as const;

/** `PATCH /operations/:id/status` (`ChangeOperationStatusDto`). */
export interface ChangeOperationStatusInput {
  status: OperationStatus;
  reason?: string;
}

/** `POST /operations/:id/assignments` (`AssignOperationUserDto`). */
export interface AssignOperationUserInput {
  userId: string;
}

/* ------------------------------------------------------------------ */
/* Checklists                                                          */
/* ------------------------------------------------------------------ */

export interface ChecklistTemplateRef {
  id: string;
  key: string;
  name: string;
}

/**
 * Modelo de checklist (`GET /checklist-templates`).
 *
 * `operationKind` é o vínculo com o tipo de atendimento. Nulo significa que o
 * modelo serve a qualquer tipo — é o que todo modelo era antes de a coluna
 * existir.
 */
export interface ChecklistTemplate {
  id: string;
  key: string;
  name: string;
  description: string | null;
  operationKind: OperationKind | null;
  version: number;
  isActive: boolean;
  items: readonly ChecklistItem[];
}

export interface ChecklistTemplateQuery {
  operationKind?: OperationKind;
  isActive?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

/** `POST /operations/:id/checklists`. */
export interface StartChecklistInput {
  templateId: string;
  notes?: string;
  /** Itens só desta execução; o modelo não muda. */
  additionalItems?: readonly ChecklistItem[];
}

/** Item do snapshot do template (`ChecklistItemDto`). */
export interface ChecklistItem {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: readonly string[];
}

/** Execução completa (`checklist.repository.findExecution`). */
export interface ChecklistExecution {
  id: string;
  organizationId: string;
  businessUnitId: string;
  templateId: string;
  operationId: string | null;
  createdById: string;
  status: string;
  templateVersion: number;
  templateSnapshot: { items?: readonly ChecklistItem[] } | null;
  answers: Readonly<Record<string, unknown>>;
  progress: number;
  notes: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  template: ChecklistTemplateRef;
  createdBy: { id: string; displayName: string };
  operation?: { id: string; code: string; title: string } | null;
}

export interface ChecklistExecutionQuery {
  operationId?: string;
  businessUnitId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

/* ------------------------------------------------------------------ */
/* Orbit Intelligence da operação                                      */
/* ------------------------------------------------------------------ */

/** Execução de IA (`GET /ai-executions?operationId=`). */
export interface AiExecution {
  id: string;
  agentId: string | null;
  operationId: string | null;
  purpose: string;
  status: string;
  model: string | null;
  /** JSON livre produzido pelo agente; o formato depende do `purpose`. */
  output: unknown;
  error: unknown;
  durationMs: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AiExecutionQuery {
  operationId?: string;
  /** `AiExecutionQueryDto` também aceita cliente e relatório. */
  customerId?: string;
  reportId?: string;
  agentId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

/* ------------------------------------------------------------------ */
/* Apresentação                                                        */
/* ------------------------------------------------------------------ */

export const OPERATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  OPEN: "Aberta",
  SCHEDULED: "Agendada",
  IN_PROGRESS: "Em execução",
  PAUSED: "Pausada",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

export const OPERATION_STATUS_CLASSES: Readonly<Record<string, string>> = {
  OPEN: "bg-surface-strong text-muted-foreground",
  SCHEDULED: "bg-chart-1/15 text-chart-1",
  IN_PROGRESS: "bg-warning/15 text-warning",
  PAUSED: "bg-surface-strong text-muted-foreground",
  COMPLETED: "bg-success/15 text-success",
  CANCELLED: "bg-destructive/15 text-destructive",
};

export const OPERATION_PRIORITY_LABELS: Readonly<Record<string, string>> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
  CRITICAL: "Crítica",
};

export const OPERATION_KIND_LABELS: Readonly<Record<string, string>> = {
  INSTALLATION: "Instalação",
  MAINTENANCE: "Manutenção",
  INSPECTION: "Inspeção",
  DELIVERY: "Entrega",
  OTHER: "Outra",
};

export const OPERATION_HISTORY_LABELS: Readonly<Record<string, string>> = {
  CREATED: "Operação criada",
  UPDATED: "Operação atualizada",
  STATUS_CHANGED: "Status alterado",
  USER_ASSIGNED: "Técnico atribuído",
  USER_UNASSIGNED: "Técnico removido",
  ATTACHMENT_ADDED: "Anexo adicionado",
  ATTACHMENT_REMOVED: "Anexo removido",
  CHECKLIST_STARTED: "Checklist iniciado",
  CHECKLIST_COMPLETED: "Checklist concluído",
  CHECKLIST_CANCELLED: "Checklist cancelado",
  DELETED: "Operação removida",
};

/* ------------------------------------------------------------------ */
/* Roteiros — o catálogo que o dono da organização mantém              */
/* ------------------------------------------------------------------ */

/** Os tipos de resposta que um item de roteiro aceita. */
export const CHECKLIST_ITEM_TYPES = [
  { value: "BOOLEAN", label: "Sim / Não" },
  { value: "TEXT", label: "Texto" },
  { value: "NUMBER", label: "Número" },
  { value: "SELECT", label: "Escolha" },
  { value: "PHOTO", label: "Foto" },
  { value: "SIGNATURE", label: "Assinatura" },
] as const;

/** `POST /checklist-templates`. */
export interface CreateChecklistTemplateInput {
  key: string;
  name: string;
  description?: string;
  /**
   * O tipo de atendimento a que o roteiro pertence.
   *
   * É o que faz o formulário de nova operação achar o roteiro ao escolher o
   * tipo. Omitido, o roteiro serve a qualquer tipo.
   */
  operationKind?: OperationKind;
  items: readonly ChecklistItem[];
  isActive?: boolean;
}

export type UpdateChecklistTemplateInput =
  Partial<CreateChecklistTemplateInput>;

/* ---------------------------------------------------------------- */
/* Pedido de cancelamento vindo do campo                             */
/* ---------------------------------------------------------------- */

export type {
  OperationCancellationResolution,
  OperationCancellationStatus,
} from "./contracts/modules/operations/operation-cancellation.read-models";

import type {
  OperationCancellationInboxItemReadModel,
  OperationCancellationResolution as Resolucao,
} from "./contracts/modules/operations/operation-cancellation.read-models";

/** Um pedido na caixa de entrada do dono. */
export type OperationCancellationRequest =
  OperationCancellationInboxItemReadModel;

/** Alias interno, para as assinaturas abaixo não dependerem da re-exportação. */
export type OperationCancellationDecision = Resolucao;
