/**
 * Contratos do Automation Engine.
 *
 * Nenhum Read Model é redeclarado: todos vêm de `contracts/modules/automations`.
 * O que este arquivo acrescenta são os tipos de entrada e os rótulos.
 *
 * ## O catálogo é do servidor
 *
 * Gatilhos, ações, operadores e unidades de prazo chegam por
 * `GET /automations/catalog`. **Não existe lista de gatilhos escrita aqui** —
 * uma cópia divergiria no primeiro evento novo e ofereceria automações que o
 * motor não sabe disparar.
 *
 * Os rótulos abaixo traduzem os conjuntos fechados que já são contrato
 * (`AutomationConditionOperator`, `AutomationDelayUnit`,
 * `AutomationExecutionStatus`). Valor sem rótulo aparece cru: um operador novo
 * do backend precisa aparecer, não sumir.
 *
 * ## O que a interface não sabe fazer
 *
 * Não avalia condição, não calcula prazo e não decide se uma regra pode ser
 * excluída. Um prazo de seis meses viaja como `{ amount: 6, unit: "MONTHS" }`
 * — converter para dias no navegador jogaria fora a semântica de calendário
 * que o servidor tem e o `Date` do JavaScript não tem.
 */
import type {
  AutomationActionReadModel,
  AutomationCatalogReadModel,
  AutomationConditionReadModel,
  AutomationExecutionReadModel,
  AutomationRuleReadModel,
} from "./contracts/modules/automations/automation.read-models";
import type {
  AutomationActionType,
  AutomationConditionOperator,
  AutomationDelayUnit,
  AutomationExecutionStatus,
  AutomationNotificationTarget,
} from "./contracts";

export type {
  AutomationActionType,
  AutomationConditionOperator,
  AutomationDelayUnit,
  AutomationExecutionStatus,
  AutomationNotificationTarget,
};

export type AutomationRule = AutomationRuleReadModel;
export type AutomationAction = AutomationActionReadModel;
export type AutomationCondition = AutomationConditionReadModel;
export type AutomationExecution = AutomationExecutionReadModel;
export type AutomationCatalog = AutomationCatalogReadModel;

export type AutomationTriggerDefinition = AutomationCatalog["triggers"][number];
export type AutomationActionDefinition = AutomationCatalog["actions"][number];
export type AutomationConfigField =
  AutomationActionDefinition["config"][number];

/* -------------------------------------------------------------------- */
/* Entradas                                                              */
/* -------------------------------------------------------------------- */

export interface AutomationConditionInput {
  field: string;
  operator: AutomationConditionOperator;
  /** Texto para `equals`/`notEquals`, lista para `in`, ausente em `exists`. */
  value?: string | string[];
}

export interface AutomationDelayInput {
  amount: number;
  unit: AutomationDelayUnit;
}

export interface AutomationActionInput {
  type: AutomationActionType;
  delay?: AutomationDelayInput;
  config: Record<string, unknown>;
}

/**
 * Criação.
 *
 * Sem `enabled`: a regra nasce ligada, e é o backend quem define isso. Um
 * campo aqui daria a impressão de que a interface escolhe.
 */
export interface CreateAutomationRuleInput {
  name: string;
  description?: string;
  trigger: string;
  businessUnitId?: string;
  conditions?: AutomationConditionInput[];
  actions: AutomationActionInput[];
}

/** Edição. **Sem `trigger`** — trocá-lo faria da regra outra regra. */
export interface UpdateAutomationRuleInput {
  name?: string;
  description?: string;
  conditions?: AutomationConditionInput[];
  actions?: AutomationActionInput[];
}

export interface AutomationRuleQuery {
  search?: string;
  trigger?: string;
  businessUnitId?: string;
  enabled?: boolean;
  page?: number;
  limit?: number;
}

export interface AutomationExecutionQuery {
  ruleId?: string;
  status?: AutomationExecutionStatus;
  page?: number;
  limit?: number;
}

/* -------------------------------------------------------------------- */
/* Apresentação                                                          */
/* -------------------------------------------------------------------- */

export const AUTOMATION_OPERATOR_LABELS: Readonly<Record<string, string>> = {
  equals: "é igual a",
  notEquals: "é diferente de",
  in: "está entre",
  exists: "está preenchido",
};

export const AUTOMATION_DELAY_UNIT_LABELS: Readonly<Record<string, string>> = {
  MINUTES: "minutos",
  HOURS: "horas",
  DAYS: "dias",
  WEEKS: "semanas",
  MONTHS: "meses",
};

/** Singular, para "em 1 mês". */
export const AUTOMATION_DELAY_UNIT_SINGULAR: Readonly<Record<string, string>> =
  {
    MINUTES: "minuto",
    HOURS: "hora",
    DAYS: "dia",
    WEEKS: "semana",
    MONTHS: "mês",
  };

export const AUTOMATION_EXECUTION_STATUS_LABELS: Readonly<
  Record<string, string>
> = {
  PENDING: "Agendada",
  RUNNING: "Executando",
  SUCCEEDED: "Concluída",
  FAILED: "Falhou",
  SKIPPED: "Descartada",
};

export const AUTOMATION_EXECUTION_STATUS_CLASSES: Readonly<
  Record<string, string>
> = {
  PENDING: "bg-chart-1/15 text-chart-1",
  RUNNING: "bg-warning/15 text-warning",
  SUCCEEDED: "bg-success/15 text-success",
  FAILED: "bg-destructive/15 text-destructive",
  SKIPPED: "bg-surface-strong text-muted-foreground",
};

export const AUTOMATION_NOTIFICATION_TARGET_LABELS: Readonly<
  Record<string, string>
> = {
  OWNER: "Quem criou o registro",
  ACTOR: "Quem provocou o evento",
  USER: "Uma pessoa específica",
};

/**
 * Rótulo dos campos de condição.
 *
 * Os campos vêm do gatilho publicado (`trigger.fields`); o backend não publica
 * nome de exibição para eles, e `businessUnitId` numa tela em português é
 * ruído. Campo sem rótulo aparece cru — um campo novo do backend precisa
 * aparecer.
 */
export const AUTOMATION_FIELD_LABELS: Readonly<Record<string, string>> = {
  kind: "Tipo",
  status: "Situação",
  fromStatus: "Situação anterior",
  priority: "Prioridade",
  businessUnitId: "Organização",
  customerId: "Cliente",
  assetId: "Equipamento",
  operationId: "Operação",
  executionId: "Execução",
  catalogItemId: "Item do catálogo",
  artifactType: "Tipo de documento",
  templateKey: "Chave do template",
  total: "Valor total",
  currency: "Moeda",
};

/** Rótulo das chaves de configuração de ação. */
export const AUTOMATION_CONFIG_LABELS: Readonly<Record<string, string>> = {
  title: "Título",
  description: "Descrição",
  durationMinutes: "Duração na agenda (minutos)",
  body: "Mensagem",
  target: "Destinatário",
  userId: "Pessoa",
  queue: "Trabalho",
  payload: "Dados do trabalho",
};

export function automationFieldLabel(field: string): string {
  return AUTOMATION_FIELD_LABELS[field] ?? field;
}
