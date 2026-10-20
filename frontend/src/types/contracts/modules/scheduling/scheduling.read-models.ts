/**
 * ARQUIVO GERADO — NÃO EDITE MANUALMENTE.
 * Fonte: backend/src
 * Regenerar: npm run contracts:sync
 */

export type SchedulingOccurrenceReadModel = {
  occurrenceId: string;
  eventId: string;
  calendarId: string;
  title: string;
  description: string | null;
  type: string;
  status: string;
  priority: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  timezone: string;
  businessUnitId: string | null;
  customerId: string | null;
  assetId: string | null;
  segment: string | null;
  source: {
    module: string;
    entityType: string;
    entityId: string | null;
  };
  location: unknown;
  allocations: Array<{
    id: string;
    resourceType: string;
    userId: string | null;
    assetId: string | null;
    resourceKey: string | null;
    role: string | null;
    status: string;
  }>;
  assignmentAuthority: 'OPERATION' | 'SCHEDULING';
  responsibleFieldTechnician: {
    userId: string;
    role: 'RESPONSIBLE_FIELD_TECHNICIAN';
  } | null;
  auxiliaryTechnicians: Array<{ userId: string; role: 'AUXILIARY_TECHNICIAN' }>;
  recurring: boolean;
};

export type AgendaReadModel = {
  view: 'DAY' | 'WEEK' | 'MONTH';
  range: { from: string; to: string; timezone: string };
  summary: {
    total: number;
    confirmed: number;
    tentative: number;
    blocked: number;
    hoursAllocated: number;
  };
  days: Array<{
    date: string;
    events: SchedulingOccurrenceReadModel[];
  }>;
  generatedAt: string;
};

export type SchedulingTimelineReadModel = {
  eventId: string;
  event: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    status: string;
  };
  history: Array<{
    id: string;
    action: string;
    actor: { id: string; name: string } | null;
    details: unknown;
    createdAt: string;
  }>;
  generatedAt: string;
};

export type SchedulingConflictReadModel = {
  id: string;
  severity: 'WARNING' | 'CRITICAL';
  type:
    | 'EVENT_OVERLAP'
    | 'RESOURCE_OVERLAP'
    | 'BLOCKED_AVAILABILITY'
    | 'OUTSIDE_AVAILABILITY';
  eventId?: string;
  conflictingEventId?: string;
  resourceType?: string;
  resourceId?: string;
  startsAt: string;
  endsAt: string;
  message: string;
};

export type SchedulingIntelligenceReadModel = {
  generatedAt: string;
  source: 'MOCK';
  horizon: { from: string; to: string };
  conflicts: SchedulingConflictReadModel[];
  routeOptimizations: Array<{
    id: string;
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    affectedEventIds: string[];
    estimatedDistanceReductionPercent: number;
    estimatedTimeSavedMinutes: number;
    recommendation: string;
  }>;
  delayPredictions: Array<{
    eventId: string;
    probability: number;
    estimatedDelayMinutes: number;
    factors: string[];
  }>;
  reschedulingRecommendations: Array<{
    eventId: string;
    currentStartsAt: string;
    suggestedStartsAt: string;
    reason: string;
    confidence: number;
  }>;
  weatherImpact: {
    applicable: boolean;
    segment: string;
    risk: 'LOW' | 'MEDIUM' | 'HIGH';
    summary: string;
    affectedEventIds: string[];
    recommendations: string[];
  };
};

export type DashboardSchedulingReadModel = {
  generatedAt: string;
  today: {
    total: number;
    completed: number;
    upcoming: number;
    conflicts: number;
  };
  nextEvents: SchedulingOccurrenceReadModel[];
  intelligence: {
    highRiskDelays: number;
    criticalConflicts: number;
    weatherRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  };
};
