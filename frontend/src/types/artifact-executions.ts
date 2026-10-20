/**
 * Contratos do módulo Artifact Executions.
 *
 * As formas de leitura vêm dos Read Models sincronizados
 * (`npm run contracts:sync`). Aqui ficam só os DTOs de entrada — classes com
 * `class-validator` no backend, que não são sincronizáveis — e os literais que
 * o backend declara como listas fechadas.
 *
 * O que **não** está aqui, deliberadamente: a máquina de estados. As
 * transições válidas são de `ArtifactExecutionStateMachine`, no servidor.
 * Reproduzi-las aqui criaria uma segunda fonte de verdade.
 */
import type {
  ArtifactExecutionAttachmentReadModel,
  ArtifactExecutionInsightReadModel,
  ArtifactExecutionListItemReadModel,
  ArtifactExecutionProgressReadModel,
  ArtifactExecutionReadModel,
  ArtifactExecutionResponseReadModel,
  ArtifactExecutionSignatureReadModel,
  ArtifactSnapshotReadModel,
  ArtifactRenderStatus,
} from "./contracts/modules/artifact-executions/artifact-execution.read-models";

export type ArtifactExecution = ArtifactExecutionReadModel;
export type ArtifactExecutionListItem = ArtifactExecutionListItemReadModel;
export type ArtifactExecutionResponse = ArtifactExecutionResponseReadModel;
export type ArtifactExecutionAttachment = ArtifactExecutionAttachmentReadModel;
export type ArtifactExecutionSignature = ArtifactExecutionSignatureReadModel;
export type ArtifactExecutionInsight = ArtifactExecutionInsightReadModel;
export type ArtifactExecutionProgress = ArtifactExecutionProgressReadModel;
export type ArtifactSnapshot = ArtifactSnapshotReadModel;
export type { ArtifactRenderStatus };

export { ARTIFACT_RENDER_STATUSES } from "./contracts/modules/artifact-executions/artifact-execution.read-models";

/**
 * Status de execução — lista fechada em `ARTIFACT_EXECUTION_STATUSES`
 * (`@IsIn` no DTO e `CHECK` no banco).
 *
 * A lista é fechada; **a ordem entre eles não é**. Quais transições valem é
 * decisão do servidor a cada pedido.
 */
export const ARTIFACT_EXECUTION_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "PAUSED",
  "UNDER_REVIEW",
  "APPROVED",
  "COMPLETED",
  "ARCHIVED",
] as const;
export type ArtifactExecutionStatus =
  (typeof ARTIFACT_EXECUTION_STATUSES)[number];

/** Origem declarada de uma resposta (`SaveArtifactResponseDto.provenance`). */
export const ARTIFACT_RESPONSE_PROVENANCES = [
  "USER",
  "SENSOR",
  "IMPORT",
  "SYSTEM",
  "AI",
] as const;
export type ArtifactResponseProvenance =
  (typeof ARTIFACT_RESPONSE_PROVENANCES)[number];

/** Natureza do anexo (`RegisterArtifactAttachmentDto.kind`). */
export const ARTIFACT_ATTACHMENT_KINDS = [
  "IMAGE",
  "VIDEO",
  "DOCUMENT",
] as const;
export type ArtifactAttachmentKind = (typeof ARTIFACT_ATTACHMENT_KINDS)[number];

/** `GET /artifact-executions` (`ArtifactExecutionQueryDto`). */
export interface ArtifactExecutionQuery {
  businessUnitId?: string;
  operationId?: string;
  customerId?: string;
  assetId?: string;
  responsibleUserId?: string;
  status?: ArtifactExecutionStatus;
  /** Estado da emissão — outra coisa que `status`, que é o da execução. */
  renderStatus?: ArtifactRenderStatus;
  /** Tipo do artefato, como o snapshot congelou. */
  artifactType?: string;
  /** Período pela criação da execução. `YYYY-MM-DD` ou instante ISO. */
  createdFrom?: string;
  createdTo?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/** `PATCH /artifact-executions/:id/status` (`ChangeArtifactExecutionStatusDto`). */
export interface ChangeArtifactExecutionStatusInput {
  status: ArtifactExecutionStatus;
}

/** `PUT /artifact-executions/:id/responses` (`SaveArtifactResponseDto`). */
export interface SaveArtifactResponseInput {
  sectionId: string;
  fieldId: string;
  value: unknown;
  unit?: string;
  provenance?: ArtifactResponseProvenance;
  notes?: string;
}

/** `POST /artifact-executions/:id/attachments` (`RegisterArtifactAttachmentDto`). */
export interface RegisterArtifactAttachmentInput {
  responseId?: string;
  sectionId?: string;
  kind: ArtifactAttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  checksum?: string;
  metadata?: Record<string, unknown>;
}

/** `PATCH /artifact-executions/:id` (`UpdateArtifactExecutionDto`). */
export interface UpdateArtifactExecutionInput {
  title?: string;
  responsibleUserId?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  notes?: string;
  context?: Record<string, unknown>;
  team?: readonly { userId: string; role: string }[];
}

/**
 * Códigos de erro que o módulo publica e que a interface trata por nome.
 *
 * Reagir ao código, e não ao texto, é o que permite ao Workspace **aprender**
 * uma regra do servidor sem reproduzi-la: ao receber
 * `ARTIFACT_EXECUTION_NOT_EDITABLE`, ele passa a apresentar a execução como
 * somente leitura — porque o servidor disse, não porque o frontend deduziu.
 */
export const ARTIFACT_EXECUTION_ERROR_CODES = {
  notEditable: "ARTIFACT_EXECUTION_NOT_EDITABLE",
  incomplete: "ARTIFACT_EXECUTION_INCOMPLETE",
  invalidTransition: "INVALID_ARTIFACT_EXECUTION_TRANSITION",
} as const;

/** Limites declarados pelo `class-validator`, para retorno imediato na tela. */
export const ARTIFACT_EXECUTION_LIMITS = {
  titleMaxLength: 220,
  notesMaxLength: 5000,
  responseNotesMaxLength: 4000,
  unitMaxLength: 40,
  fileNameMaxLength: 255,
  mimeTypeMaxLength: 160,
  storageKeyMaxLength: 500,
  checksumPattern: /^[a-fA-F0-9]{64}$/,
  maxSizeBytes: 5_000_000_000,
} as const;
