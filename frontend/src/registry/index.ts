/**
 * Registry Kernel — infraestrutura comum dos registries.
 *
 * `import { createRegistry, allowsAccess } from "@/registry";`
 *
 * Ver `docs/registry-kernel.md`.
 */
export {
  createRegistry,
  humanizeId,
  sortByRegistryOrder,
  warnUnknown,
  type Registry,
  type RegistryEntry,
  type RegistryOptions,
} from "./kernel";
export {
  accessBlockReason,
  allowsAccess,
  type AccessContext,
  type AccessRequirement,
} from "./access";
export {
  actionAuthority,
  availableTransitions,
  type ActionAuthority,
} from "./allowed-actions";
export {
  ALLOCATION_ROLES,
  ASSIGNMENT_AUTHORITY,
  allocationRoleLabel,
  assignmentAuthorityLabel,
  BLOCKED_REASONS,
  CREDENTIAL_TYPES,
  PROFESSIONAL_ROLES,
  blockedReasonLabel,
  credentialLabel,
  credentialTypeName,
  knownBlockedReason,
  professionalRoleLabel,
  professionalRoleLabels,
  signatureStatusLabel,
  type ProfessionalRolePresentation,
} from "./professional";
export {
  COMPLIANCE_STATUS,
  CYCLE_STATUS,
  DOCUMENT_STATUS,
  EQUIPMENT_EXECUTION_STATUS,
  EXECUTION_BLOCKED_REASONS,
  PLAN_STATUS,
  complianceStatus,
  cycleStatus,
  documentStatus,
  equipmentExecutionStatus,
  executionBlockedLabel,
  planStatus,
  type PmocPresentation,
  type PmocTone,
} from "./pmoc";
export {
  CONFIGURATION_STATUS,
  DOCUMENT_STATUS as RVT_DOCUMENT_STATUS,
  DUE_STATE,
  EXECUTION_STATUS as RVT_EXECUTION_STATUS,
  OCCURRENCE_BLOCKED_REASONS,
  OCCURRENCE_STATUS,
  RENDER_STATUS,
  SCHEDULE_MODE,
  cadenciaDe,
  configurationStatus,
  documentStatus as rvtDocumentStatus,
  dueState,
  executionStatus as rvtExecutionStatus,
  isOneTime,
  occurrenceBlockedLabel,
  occurrenceStatus,
  recurrenceLabel,
  renderStatus,
  scheduleMode,
  type RvtPresentation,
  type RvtTone,
} from "./rvt";
export {
  FIELD_ACTIONS,
  LABEL_CONTENT_TYPES,
  LABEL_FORMATS,
  QR_STATUS,
  fieldAction,
  labelFormat,
  qrStatus,
  type LabelFormat,
  type QrPresentation,
  type QrTone,
} from "./equipment-qr";

export { lifecycleLabel } from "./lifecycle";
