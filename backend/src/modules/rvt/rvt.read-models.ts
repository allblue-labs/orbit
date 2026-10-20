/** Um ritmo de manutenção, com o roteiro que o técnico preenche. */
export interface RvtMaintenanceTypeReadModel {
  id: string;
  key: string;
  label: string;
  /** Cadência em dias. Exclusivo com `intervalMonths`. */
  intervalDays: number | null;
  /** Cadência em meses de calendário. Exclusivo com `intervalDays`. */
  intervalMonths: number | null;
  checklist: { id: string; name: string; version: number } | null;
}

export interface RvtPartyReadModel {
  id: string;
  name: string;
}
export interface RvtEquipmentReadModel {
  id: string;
  name: string;
  category: string;
  identifier: string | null;
  serialNumber: string | null;
  addedDuringExecution?: boolean;
}
export interface RvtOccurrenceReadModel {
  id: string;
  configurationId: string;
  sequenceNumber: number;
  sequence: string;
  scheduledFor: string | null;
  localScheduledDate: string | null;
  status: string;
  dueState: 'UPCOMING' | 'DUE_TODAY' | 'OVERDUE';
  executionId: string | null;
  allowedActions: readonly string[];
}
export interface RvtConfigurationReadModel {
  id: string;
  code: string;
  name: string;
  /**
   * O tipo de manutenção contratado.
   *
   * Era `visitType`, um literal de dois valores. Nulo só em contrato antigo
   * cujo tipo foi removido do catálogo — o cadastro exige um.
   */
  maintenanceType: RvtMaintenanceTypeReadModel | null;
  scheduleMode: string;
  status: string;
  coverage: { start: string; end: string | null };
  timezone: string;
  businessUnit: RvtPartyReadModel;
  customer: RvtPartyReadModel;
  serviceLocation: unknown;
  recurrence: unknown;
  procedure: unknown;
  technicalResponsible: RvtPartyReadModel | null;
  defaultResponsibleFieldTechnician: RvtPartyReadModel | null;
  requiresTechnicalResponsible: boolean;
  equipment: readonly RvtEquipmentReadModel[];
  occurrences: readonly RvtOccurrenceReadModel[];
  createdAt: string;
  updatedAt: string;
}
export interface RvtExecutionReadModel {
  id: string;
  occurrenceId: string;
  status: string;
  performedAt: string | null;
  startedAt: string;
  completedAt: string | null;
  responsibleFieldTechnician: RvtPartyReadModel;
  auxiliaryTechnicians: readonly RvtPartyReadModel[];
  technicalResponsible: RvtPartyReadModel | null;
  procedureSnapshot: unknown;
  configurationSnapshot: unknown;
  observations: unknown;
  recommendations: unknown;
  freeTextRecommendation: string | null;
  equipment: readonly RvtEquipmentReadModel[];
  evidence: readonly {
    id: string;
    kind: string;
    caption: string | null;
    fileId: string;
    assetId: string | null;
  }[];
  customerAcknowledgement: unknown;
  operation: { id: string; code: string; status: string } | null;
  artifact: {
    id: string;
    code: string;
    status: string;
    renderStatus: string;
  } | null;
  allowedActions: readonly string[];
}
export interface RvtExecutionPreparationReadModel {
  configuration: RvtConfigurationReadModel;
  occurrence: RvtOccurrenceReadModel;
  execution: RvtExecutionReadModel | null;
  availableAuxiliaryTechnicians: readonly RvtPartyReadModel[];
  executionEligibility: { eligible: boolean; blockers: readonly string[] };
  policies: {
    customerSignatureRequired: false;
    fieldTechnicianSignatureRequired: true;
    technicalResponsibleSignatureRequired: boolean;
    evidence: {
      optional: true;
      maximumFiles: number;
      acceptedKinds: readonly string[];
    };
    artifactFromExecutionOnly: true;
  };
  allowedActions: readonly string[];
}
export interface RvtTimelineItemReadModel {
  id: string;
  type: string;
  message: string;
  occurredAt: string;
  actor: RvtPartyReadModel | null;
  equipment: RvtPartyReadModel | null;
  data: Record<string, unknown>;
}
