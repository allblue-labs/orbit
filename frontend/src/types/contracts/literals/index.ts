/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

const literal = <T extends Record<string, string>>(value: T): Readonly<T> =>
  value;

export const UserStatus = literal({
  PENDING_VERIFICATION: 'PENDING_VERIFICATION',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DISABLED: 'DISABLED',
});
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const MembershipStatus = literal({
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REVOKED: 'REVOKED',
});
export type MembershipStatus =
  (typeof MembershipStatus)[keyof typeof MembershipStatus];

export const BusinessUnitType = literal({
  HEADQUARTERS: 'HEADQUARTERS',
  BRANCH: 'BRANCH',
  DEPARTMENT: 'DEPARTMENT',
  SITE: 'SITE',
});
export type BusinessUnitType =
  (typeof BusinessUnitType)[keyof typeof BusinessUnitType];

export const PlanType = literal({
  FREE: 'FREE',
  STARTER: 'STARTER',
  PROFESSIONAL: 'PROFESSIONAL',
  ENTERPRISE: 'ENTERPRISE',
});
export type PlanType = (typeof PlanType)[keyof typeof PlanType];

export const OperationKind = literal({
  INSTALLATION: 'INSTALLATION',
  MAINTENANCE: 'MAINTENANCE',
  INSPECTION: 'INSPECTION',
  DELIVERY: 'DELIVERY',
  OTHER: 'OTHER',
});
export type OperationKind = (typeof OperationKind)[keyof typeof OperationKind];

export const OperationStatus = literal({
  OPEN: 'OPEN',
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});
export type OperationStatus =
  (typeof OperationStatus)[keyof typeof OperationStatus];

export const OperationPriority = literal({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
});
export type OperationPriority =
  (typeof OperationPriority)[keyof typeof OperationPriority];

export const RvtVisitType = literal({
  WEEKLY: 'WEEKLY',
  SEMIANNUAL: 'SEMIANNUAL',
});
export type RvtVisitType = (typeof RvtVisitType)[keyof typeof RvtVisitType];

export const RvtScheduleMode = literal({
  RECURRING: 'RECURRING',
  ONE_TIME: 'ONE_TIME',
});
export type RvtScheduleMode =
  (typeof RvtScheduleMode)[keyof typeof RvtScheduleMode];

export const RvtConfigurationStatus = literal({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});
export type RvtConfigurationStatus =
  (typeof RvtConfigurationStatus)[keyof typeof RvtConfigurationStatus];

export const RvtOccurrenceStatus = literal({
  SCHEDULED: 'SCHEDULED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});
export type RvtOccurrenceStatus =
  (typeof RvtOccurrenceStatus)[keyof typeof RvtOccurrenceStatus];

export const RvtExecutionStatus = literal({
  IN_PROGRESS: 'IN_PROGRESS',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});
export type RvtExecutionStatus =
  (typeof RvtExecutionStatus)[keyof typeof RvtExecutionStatus];

export const OperationHistoryAction = literal({
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  USER_ASSIGNED: 'USER_ASSIGNED',
  USER_UNASSIGNED: 'USER_UNASSIGNED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  ATTACHMENT_REMOVED: 'ATTACHMENT_REMOVED',
  DELETED: 'DELETED',
});
export type OperationHistoryAction =
  (typeof OperationHistoryAction)[keyof typeof OperationHistoryAction];

export const ProductKind = literal({
  PRODUCT: 'PRODUCT',
  SERVICE: 'SERVICE',
  PART: 'PART',
});
export type ProductKind = (typeof ProductKind)[keyof typeof ProductKind];

/**
 * Disponibilidade de um item do catálogo.
 *
 * A coluna `products.status` existe desde a criação do modelo e já era
 * publicada no Read Model, mas nenhum contrato a aceitava — nem para escrever,
 * nem para filtrar. Retirar um item de circulação só era possível apagando-o
 * (soft delete), o que some com o registro e com o histórico.
 *
 * O literal formaliza os dois valores que o repositório já usava em texto:
 * `ACTIVE` no `findAvailableProduct` e `INACTIVE` no `softDeleteProduct`.
 */
/**
 * Ciclo de vida de um convite.
 *
 * Os quatro valores que `IdentityInvitation.status` já usava em texto:
 * `PENDING` ao criar, `ACCEPTED` no `accept`, `EXPIRED` na limpeza por prazo e
 * `REVOKED` no cancelamento.
 */
export const InvitationStatus = literal({
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
});
export type InvitationStatus =
  (typeof InvitationStatus)[keyof typeof InvitationStatus];

export const ProductStatus = literal({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export const AssetCategory = literal({
  EQUIPMENT: 'EQUIPMENT',
  VEHICLE: 'VEHICLE',
  TOOL: 'TOOL',
  FACILITY: 'FACILITY',
  OTHER: 'OTHER',
});
export type AssetCategory = (typeof AssetCategory)[keyof typeof AssetCategory];

export const AssetIdentifierType = literal({
  SERIAL_NUMBER: 'SERIAL_NUMBER',
  QR_CODE: 'QR_CODE',
  NFC: 'NFC',
  INTERNAL_CODE: 'INTERNAL_CODE',
  BARCODE: 'BARCODE',
  RFID: 'RFID',
  CUSTOM: 'CUSTOM',
});
export type AssetIdentifierType =
  (typeof AssetIdentifierType)[keyof typeof AssetIdentifierType];

export const AssetStatus = literal({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  MAINTENANCE: 'MAINTENANCE',
  RETIRED: 'RETIRED',
});
export type AssetStatus = (typeof AssetStatus)[keyof typeof AssetStatus];

export const CustomerType = literal({
  COMPANY: 'COMPANY',
  INDIVIDUAL: 'INDIVIDUAL',
});
export type CustomerType = (typeof CustomerType)[keyof typeof CustomerType];

export const CustomerStatus = literal({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  PROSPECT: 'PROSPECT',
  BLOCKED: 'BLOCKED',
});
export type CustomerStatus =
  (typeof CustomerStatus)[keyof typeof CustomerStatus];

export const NotificationChannel = literal({
  IN_APP: 'IN_APP',
  REALTIME: 'REALTIME',
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
});
export type NotificationChannel =
  (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = literal({
  PENDING: 'PENDING',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  READ: 'READ',
  FAILED: 'FAILED',
});
export type NotificationStatus =
  (typeof NotificationStatus)[keyof typeof NotificationStatus];

export const NotificationType = literal({
  SYSTEM: 'SYSTEM',
  OPERATION: 'OPERATION',
  REPORT: 'REPORT',
  REMINDER: 'REMINDER',
});
export type NotificationType =
  (typeof NotificationType)[keyof typeof NotificationType];

export const IntegrationProvider = literal({
  GOOGLE: 'GOOGLE',
  MICROSOFT: 'MICROSOFT',
  WHATSAPP: 'WHATSAPP',
  OPENAI_COMPATIBLE: 'OPENAI_COMPATIBLE',
  CUSTOM: 'CUSTOM',
});
export type IntegrationProvider =
  (typeof IntegrationProvider)[keyof typeof IntegrationProvider];

export const IntegrationCategory = literal({
  COMMUNICATION: 'COMMUNICATION',
  STORAGE: 'STORAGE',
  CALENDAR: 'CALENDAR',
  ERP: 'ERP',
  AI: 'AI',
  OTHER: 'OTHER',
});
export type IntegrationCategory =
  (typeof IntegrationCategory)[keyof typeof IntegrationCategory];

export const SignatureStatus = literal({
  PENDING: 'PENDING',
  SIGNED: 'SIGNED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
});
export type SignatureStatus =
  (typeof SignatureStatus)[keyof typeof SignatureStatus];

export const ReportStatus = literal({
  DRAFT: 'DRAFT',
  IN_REVIEW: 'IN_REVIEW',
  APPROVED: 'APPROVED',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
});
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const AiExecutionStatus = literal({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});
export type AiExecutionStatus =
  (typeof AiExecutionStatus)[keyof typeof AiExecutionStatus];

/** Sentido do dinheiro. O sinal está aqui, nunca no valor. */
export const FinancialEntryType = literal({
  INCOME: 'INCOME',
  EXPENSE: 'EXPENSE',
});
export type FinancialEntryType =
  (typeof FinancialEntryType)[keyof typeof FinancialEntryType];

/**
 * Situação do lançamento.
 *
 * `PENDING` é previsão; `CONFIRMED` é realizado; `CANCELLED` deixou de valer
 * mas continua existindo — cancelar preserva a explicação de um saldo que
 * alguém já viu.
 */
export const FinancialEntryStatus = literal({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
});
export type FinancialEntryStatus =
  (typeof FinancialEntryStatus)[keyof typeof FinancialEntryStatus];

/**
 * De onde o fato financeiro veio.
 *
 * Só `MANUAL` é digitado por alguém. Os demais são derivados de um registro do
 * sistema, e por isso não podem ter origem nem identidade alteradas por edição.
 */
export const FinancialEntrySource = literal({
  MANUAL: 'MANUAL',
  RECEIPT: 'RECEIPT',
  QUOTE: 'QUOTE',
  SYSTEM: 'SYSTEM',
});
export type FinancialEntrySource =
  (typeof FinancialEntrySource)[keyof typeof FinancialEntrySource];

/**
 * Situação de um orçamento.
 *
 * `EXPIRED` é atribuído pelo **servidor**, comparando a validade com o próprio
 * relógio; nenhum cliente o envia. `CANCELLED` é ato de quem propôs,
 * `REJECTED` é decisão de quem recebeu — a diferença importa para saber por que
 * a proposta não virou trabalho.
 */
export const QuoteStatus = literal({
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
});
export type QuoteStatus = (typeof QuoteStatus)[keyof typeof QuoteStatus];

/**
 * Tipo de movimento de estoque.
 *
 * A **direção** é consequência do tipo, nunca do sinal da quantidade:
 * `ENTRY`, `RETURN`, `ADJUSTMENT_IN` e `TRANSFER_IN` somam; `CONSUMPTION`,
 * `ADJUSTMENT_OUT` e `TRANSFER_OUT` subtraem.
 */
export const InventoryMovementType = literal({
  ENTRY: 'ENTRY',
  CONSUMPTION: 'CONSUMPTION',
  RETURN: 'RETURN',
  ADJUSTMENT_IN: 'ADJUSTMENT_IN',
  ADJUSTMENT_OUT: 'ADJUSTMENT_OUT',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
});
export type InventoryMovementType =
  (typeof InventoryMovementType)[keyof typeof InventoryMovementType];

/**
 * Situação do saldo diante do mínimo configurado.
 *
 * Decidida pelo **servidor**: comparar saldo com mínimo no cliente daria a
 * duas telas a chance de discordar sobre o que é "baixo".
 */
export const InventoryStockStatus = literal({
  OK: 'OK',
  LOW: 'LOW',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
});
export type InventoryStockStatus =
  (typeof InventoryStockStatus)[keyof typeof InventoryStockStatus];

/* -------------------------------------------------------------------- */
/* Automation Engine                                                     */
/* -------------------------------------------------------------------- */

/**
 * Os conjuntos de automação usam `as const` em vez de `literal()`.
 *
 * O ajudante acima devolve `Readonly<Record<string, string>>`, e o tipo
 * derivado dele é `string` — suficiente para `@IsIn` em runtime, insuficiente
 * aqui: o catálogo, o interpretador de condições e os processadores decidem
 * por comparação com estes valores, e um `'CREATE_REMINDR'` digitado errado
 * precisa quebrar a compilação, não silenciar uma ação.
 */

/**
 * Operadores de condição de automação.
 *
 * Quatro, e nenhum deles executa nada. Não há `contains` nem comparação
 * numérica: os dois convidam à expressão, e expressão é o começo de linguagem.
 */
export const AutomationConditionOperator = {
  equals: 'equals',
  notEquals: 'notEquals',
  in: 'in',
  exists: 'exists',
} as const;
export type AutomationConditionOperator =
  (typeof AutomationConditionOperator)[keyof typeof AutomationConditionOperator];

/**
 * O que uma regra de automação pode fazer.
 *
 * Lista fechada. `CREATE_FOLLOW_UP_OPERATION` existe no contrato e é publicada
 * como **indisponível** pelo catálogo — declarar o limite é mais honesto que
 * esconder a opção.
 */
export const AutomationActionType = {
  CREATE_REMINDER: 'CREATE_REMINDER',
  SEND_NOTIFICATION: 'SEND_NOTIFICATION',
  CREATE_FOLLOW_UP_OPERATION: 'CREATE_FOLLOW_UP_OPERATION',
  TRIGGER_JOB: 'TRIGGER_JOB',
} as const;
export type AutomationActionType =
  (typeof AutomationActionType)[keyof typeof AutomationActionType];

/**
 * Unidade do prazo de uma ação.
 *
 * `MONTHS` e `WEEKS` têm semântica de **calendário**, resolvida no banco: um
 * mês depois de 31 de janeiro é 28 de fevereiro, não 2 de março.
 */
export const AutomationDelayUnit = {
  MINUTES: 'MINUTES',
  HOURS: 'HOURS',
  DAYS: 'DAYS',
  WEEKS: 'WEEKS',
  MONTHS: 'MONTHS',
} as const;
export type AutomationDelayUnit =
  (typeof AutomationDelayUnit)[keyof typeof AutomationDelayUnit];

/**
 * Quem recebe uma notificação de automação.
 *
 * `OWNER` é quem criou o registro; `ACTOR`, quem provocou o evento; `USER`,
 * alguém escolhido na regra. Sempre um usuário **do tenant** — não há e-mail
 * livre nem destino externo.
 */
export const AutomationNotificationTarget = {
  OWNER: 'OWNER',
  ACTOR: 'ACTOR',
  USER: 'USER',
} as const;
export type AutomationNotificationTarget =
  (typeof AutomationNotificationTarget)[keyof typeof AutomationNotificationTarget];

/** Situação de uma ação agendada por automação. */
export const AutomationExecutionStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type AutomationExecutionStatus =
  (typeof AutomationExecutionStatus)[keyof typeof AutomationExecutionStatus];

/* -------------------------------------------------------------------- */
/* PMOC & Compliance                                                     */
/* -------------------------------------------------------------------- */

/**
 * Situação de um plano PMOC.
 *
 * `EXPIRED` não é escolha de ninguém: é a constatação de que a vigência
 * acabou, atribuída pelo servidor. `CANCELLED` é terminal.
 */
export const PmocPlanStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;
export type PmocPlanStatus =
  (typeof PmocPlanStatus)[keyof typeof PmocPlanStatus];

/**
 * Unidade da periodicidade.
 *
 * Meses e anos têm semântica de **calendário**, resolvida no banco: seis meses
 * depois de 31 de agosto é 28 de fevereiro, não 180 dias depois.
 */
export const PmocFrequencyUnit = {
  DAYS: 'DAYS',
  WEEKS: 'WEEKS',
  MONTHS: 'MONTHS',
  YEARS: 'YEARS',
} as const;
export type PmocFrequencyUnit =
  (typeof PmocFrequencyUnit)[keyof typeof PmocFrequencyUnit];

/**
 * Conformidade — situação da **manutenção**, não do plano.
 *
 * `NOT_APPLICABLE` cobre o plano que não está em avaliação (rascunho,
 * suspenso, vencido, cancelado): ele não está em dia, está fora da conta.
 */
export const PmocComplianceStatus = {
  UP_TO_DATE: 'UP_TO_DATE',
  DUE_SOON: 'DUE_SOON',
  OVERDUE: 'OVERDUE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type PmocComplianceStatus =
  (typeof PmocComplianceStatus)[keyof typeof PmocComplianceStatus];

/** Situação de um ciclo de manutenção. */
export const PmocExecutionStatus = {
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type PmocExecutionStatus =
  (typeof PmocExecutionStatus)[keyof typeof PmocExecutionStatus];

/** Estado da manutenção física de um equipamento dentro do ciclo. */
export const PmocEquipmentExecutionStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type PmocEquipmentExecutionStatus =
  (typeof PmocEquipmentExecutionStatus)[keyof typeof PmocEquipmentExecutionStatus];
