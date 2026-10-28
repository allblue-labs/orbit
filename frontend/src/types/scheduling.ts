/**
 * Contratos do módulo Scheduling.
 *
 * As formas de leitura vêm dos Read Models sincronizados
 * (`npm run contracts:sync`). Aqui ficam os DTOs de entrada — classes com
 * `class-validator` no backend, não sincronizáveis — e os literais que o
 * backend declara como listas fechadas.
 *
 * O que **não** está aqui: regra de recorrência, detecção de conflito e
 * cálculo de disponibilidade. Todos moram no `SchedulingService` e no
 * `RecurrenceEngine`; o frontend envia a intenção e apresenta o resultado.
 */
import type {
  AgendaReadModel,
  DashboardSchedulingReadModel,
  SchedulingConflictReadModel,
  SchedulingIntelligenceReadModel,
  SchedulingOccurrenceReadModel,
  SchedulingTimelineReadModel,
} from "./contracts/modules/scheduling/scheduling.read-models";

export type SchedulingOccurrence = SchedulingOccurrenceReadModel;
export type SchedulingConflict = SchedulingConflictReadModel;
export type SchedulingIntelligence = SchedulingIntelligenceReadModel;
export type SchedulingTimeline = SchedulingTimelineReadModel;
export type SchedulingAgenda = AgendaReadModel;
export type SchedulingDashboard = DashboardSchedulingReadModel;

/**
 * Calendário.
 *
 * `GET /scheduling/calendars` devolve o registro do Prisma diretamente — o
 * módulo não publica Read Model para calendários, então esta forma é
 * **espelhada** do `select` do repositório. Ver a seção de lacunas em
 * `docs/scheduling-workspace.md`.
 */
export interface SchedulingCalendar {
  id: string;
  organizationId: string;
  businessUnitId: string | null;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  timezone: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Detalhe de um evento (`GET /scheduling/events/:id`).
 *
 * **Espelhado**, não sincronizado: o módulo não publica Read Model para o
 * evento individual — o controller devolve o registro do Prisma com os
 * `include` do repositório. Uma mudança silenciosa naquele `include` não
 * quebra a compilação aqui; quebra em tempo de execução, com campo nulo. É a
 * fragilidade que o manifesto de contratos já registra, e o motivo de cada
 * acesso abaixo ser tolerante a nulo.
 *
 * Em compensação, este é o único lugar do Scheduling onde **nomes** existem: a
 * listagem de ocorrências devolve apenas identificadores.
 */
export interface SchedulingEventDetail {
  id: string;
  organizationId: string;
  businessUnitId: string | null;
  calendarId: string;
  customerId: string | null;
  assetId: string | null;
  title: string;
  description: string | null;
  type: string;
  status: string;
  priority: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  segment: string | null;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId: string | null;
  location: unknown;
  metadata: unknown;
  createdAt: string;
  updatedAt: string;
  calendar: {
    id: string;
    key: string;
    name: string;
    color: string | null;
    timezone: string;
  } | null;
  recurrence: {
    id: string;
    frequency: string;
    interval: number | null;
    byWeekday: readonly number[];
    byMonthDay: number | null;
    count: number | null;
    until: string | null;
    customDates: readonly string[];
    exceptions: readonly string[];
    timezone: string;
  } | null;
  allocations: readonly {
    id: string;
    resourceType: string;
    userId: string | null;
    assetId: string | null;
    resourceKey: string | null;
    role: string | null;
    status: string;
    user: { id: string; displayName: string; avatarUrl: string | null } | null;
    asset: { id: string; name: string; identifier: string | null } | null;
  }[];
  customer: {
    id: string;
    legalName: string;
    tradeName: string | null;
  } | null;
  asset: { id: string; name: string; identifier: string | null } | null;
  createdBy: { id: string; displayName: string } | null;
}

/** Regra de disponibilidade — também espelhada do registro do Prisma. */
export interface SchedulingAvailability {
  id: string;
  organizationId: string;
  businessUnitId: string | null;
  userId: string | null;
  resourceType: string;
  resourceKey: string | null;
  kind: string;
  dayOfWeek: number | null;
  date: string | null;
  startMinute: number;
  endMinute: number;
  timezone: string;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `SchedulingEventStatus` no DTO e `CHECK` no banco. */
export const SCHEDULING_EVENT_STATUSES = [
  "TENTATIVE",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
] as const;
export type SchedulingEventStatus = (typeof SCHEDULING_EVENT_STATUSES)[number];

export const SCHEDULING_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "CRITICAL",
] as const;
export type SchedulingPriority = (typeof SCHEDULING_PRIORITIES)[number];

export const RECURRENCE_FREQUENCIES = [
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "CUSTOM",
] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const RESOURCE_TYPES = ["USER", "ASSET", "CUSTOM"] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const AVAILABILITY_KINDS = ["AVAILABLE", "BLOCKED"] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

/**
 * `type` do evento é **texto livre** (`@MaxLength(60)`, normalizado para
 * maiúsculas), não um enum. Visita técnica, PMOC e manutenção são convenções
 * do tenant — fixar uma lista aqui inventaria uma regra que o servidor não
 * tem. Estas são sugestões oferecidas no formulário.
 */
export const SUGGESTED_EVENT_TYPES = [
  "VISITA TÉCNICA",
  "PMOC",
  "MANUTENÇÃO",
  "INSTALAÇÃO",
  "INSPEÇÃO",
  "COMPROMISSO",
  "BLOQUEIO",
] as const;

/** `GET /scheduling/events`, `/conflicts` e `/intelligence` (`EventQueryDto`). */
export interface SchedulingEventQuery {
  from: string;
  to: string;
  calendarId?: string;
  businessUnitId?: string;
  userId?: string;
  customerId?: string;
  assetId?: string;
  segment?: string;
  status?: SchedulingEventStatus;
}

/** `GET /scheduling/agenda` (`AgendaQueryDto`). */
export interface SchedulingAgendaQuery {
  view: "DAY" | "WEEK" | "MONTH";
  date: string;
  businessUnitId?: string;
  userId?: string;
  customerId?: string;
  assetId?: string;
  segment?: string;
}

/** `GET /scheduling/availability` (`AvailabilityQueryDto`). */
export interface SchedulingAvailabilityQuery {
  businessUnitId?: string;
  userId?: string;
  resourceType?: ResourceType;
  resourceKey?: string;
}

export interface RecurrenceInput {
  frequency: RecurrenceFrequency;
  interval?: number;
  /** 0 = domingo. */
  byWeekday?: readonly number[];
  byMonthDay?: number;
  count?: number;
  until?: string;
  customDates?: readonly string[];
  exceptions?: readonly string[];
  timezone: string;
}

export interface ResourceAllocationInput {
  resourceType: ResourceType;
  userId?: string;
  assetId?: string;
  resourceKey?: string;
  role?: string;
}

/** `POST /scheduling/events` (`CreateEventDto`). */
export interface CreateSchedulingEventInput {
  calendarId: string;
  businessUnitId?: string;
  customerId?: string;
  assetId?: string;
  title: string;
  description?: string;
  type: string;
  status?: SchedulingEventStatus;
  priority?: SchedulingPriority;
  /** ISO 8601. O backend converte com `@Type(() => Date)`. */
  startsAt: string;
  endsAt: string;
  allDay?: boolean;
  timezone: string;
  segment?: string;
  sourceModule: string;
  sourceEntityType: string;
  sourceEntityId?: string;
  location?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  recurrence?: RecurrenceInput;
  allocations?: readonly ResourceAllocationInput[];
  /**
   * Publica mesmo havendo conflito.
   *
   * Quem detecta o conflito é o backend; esta bandeira apenas diz que o
   * usuário foi avisado e decidiu seguir.
   */
  allowConflicts?: boolean;
}

/** `PATCH /scheduling/events/:id` (`UpdateEventDto`). */
export interface UpdateSchedulingEventInput extends Partial<CreateSchedulingEventInput> {
  clearRecurrence?: boolean;
}

/** `POST /scheduling/calendars` (`CreateCalendarDto`). */
export interface CreateSchedulingCalendarInput {
  key: string;
  name: string;
  description?: string;
  businessUnitId?: string;
  color?: string;
  timezone: string;
  isDefault?: boolean;
  isActive?: boolean;
}

/** `POST /scheduling/availability` (`CreateAvailabilityDto`). */
export interface CreateSchedulingAvailabilityInput {
  businessUnitId?: string;
  userId?: string;
  resourceType: ResourceType;
  resourceKey?: string;
  kind: AvailabilityKind;
  dayOfWeek?: number;
  date?: string;
  startMinute: number;
  endMinute: number;
  timezone: string;
  effectiveFrom?: string;
  effectiveUntil?: string;
  reason?: string;
}

/** `POST /scheduling/events/:id/allocations` (`AddAllocationDto`). */
export interface AddSchedulingAllocationInput {
  allocation: ResourceAllocationInput;
  allowConflicts?: boolean;
}

/** Limites declarados pelo `class-validator`, para retorno imediato na tela. */
export const SCHEDULING_LIMITS = {
  titleMinLength: 2,
  titleMaxLength: 220,
  descriptionMaxLength: 5000,
  typeMaxLength: 60,
  segmentMaxLength: 60,
  calendarKeyPattern: /^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/,
  colorPattern: /^#[0-9A-Fa-f]{6}$/,
  recurrenceMaxInterval: 365,
  recurrenceMaxCount: 1000,
  minuteOfDayMax: 1440,
} as const;

/**
 * Código que o backend devolve quando recusa por conflito.
 *
 * Reagir ao código permite oferecer "publicar mesmo assim" sem reproduzir o
 * critério que detectou o conflito.
 */
export const SCHEDULING_ERROR_CODES = {
  conflict: "CONFLICT",
} as const;
