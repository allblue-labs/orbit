/**
 * Contratos do Dashboard e do Analytics.
 *
 * Os Read Models vêm sincronizados do backend
 * (`npm run contracts:sync`) e **não** são redeclarados aqui — este arquivo
 * apenas reexporta com nomes desambiguados, já que os módulos `dashboards` e
 * `analytics` publicam tipos homônimos (`TrendReadModel`).
 *
 * As únicas declarações próprias são os envelopes de resposta que o backend
 * monta inline no service (`DashboardService.get`) e portanto não exporta
 * como tipo.
 */
import type {
  AttentionCenterReadModel,
  DashboardReadModel,
  DashboardWidgetDefinition,
  ExecutiveKpiReadModel,
  HealthScoreReadModel,
  OrbitIntelligenceReadModel,
  RecentActivityReadModel,
  ResolvedDashboardWidget,
  SegmentMetricReadModel,
  TeamPerformanceReadModel,
  TrendReadModel as DashboardTrendReadModel,
  UpcomingEventsReadModel,
  WeatherEnvironmentalIntelligenceReadModel,
  WidgetCategory,
  WidgetSize,
} from "./contracts/modules/dashboards/dashboard.read-models";
import type {
  AnalyticsDashboardReadModel,
  AnalyticsDirection,
  AnalyticsDomain,
  AnalyticsForecast,
  AnalyticsHealthReadModel,
  AnalyticsKpi,
  AnalyticsOverviewReadModel,
  AnalyticsPanelReadModel,
  AnalyticsPeriod,
  AnalyticsStatus,
  AnalyticsTrend,
  EnvironmentalImpactReadModel,
  ForecastReadModel,
  HealthDimension,
  KpiReadModel,
  OrbitIntelligenceAnalyticsContext,
  TrendPoint,
  TrendReadModel as AnalyticsTrendReadModel,
} from "./contracts/modules/analytics/analytics.read-models";
import type {
  AgendaReadModel,
  SchedulingOccurrenceReadModel,
} from "./contracts/modules/scheduling/scheduling.read-models";

export type {
  AgendaReadModel,
  AnalyticsDashboardReadModel,
  AnalyticsDirection,
  AnalyticsDomain,
  AnalyticsForecast,
  AnalyticsHealthReadModel,
  AnalyticsKpi,
  AnalyticsOverviewReadModel,
  AnalyticsPanelReadModel,
  AnalyticsPeriod,
  AnalyticsStatus,
  AnalyticsTrend,
  AnalyticsTrendReadModel,
  AttentionCenterReadModel,
  DashboardReadModel,
  DashboardTrendReadModel,
  DashboardWidgetDefinition,
  EnvironmentalImpactReadModel,
  ExecutiveKpiReadModel,
  ForecastReadModel,
  HealthDimension,
  HealthScoreReadModel,
  KpiReadModel,
  OrbitIntelligenceAnalyticsContext,
  OrbitIntelligenceReadModel,
  RecentActivityReadModel,
  ResolvedDashboardWidget,
  SchedulingOccurrenceReadModel,
  SegmentMetricReadModel,
  TeamPerformanceReadModel,
  TrendPoint,
  UpcomingEventsReadModel,
  WeatherEnvironmentalIntelligenceReadModel,
  WidgetCategory,
  WidgetSize,
};

/** Procedência de um indicador (`AnalyticsKpi.dataQuality`). */
export type DataQuality = AnalyticsKpi["dataQuality"];

/** Faixas aceitas por `DashboardQueryDto.range`. */
export const DASHBOARD_RANGES = ["7D", "30D", "90D"] as const;
export type DashboardRangeKey = (typeof DASHBOARD_RANGES)[number];

/** Dias correspondentes a cada faixa, usados na janela do Analytics. */
export const DASHBOARD_RANGE_DAYS: Readonly<Record<DashboardRangeKey, number>> =
  {
    "7D": 7,
    "30D": 30,
    "90D": 90,
  };

export const DASHBOARD_RANGE_LABELS: Readonly<
  Record<DashboardRangeKey, string>
> = {
  "7D": "7 dias",
  "30D": "30 dias",
  "90D": "90 dias",
};

/**
 * Contexto do tenant devolvido por `GET /dashboard`.
 *
 * Montado inline em `DashboardService.get` — o backend não exporta um tipo
 * para ele.
 */
export interface DashboardContext {
  organizationId: string;
  organizationName: string;
  segment: string;
  plan: string;
  modules: readonly string[];
  range: string;
}

/** Envelope completo de `GET /dashboard`. */
export interface DashboardLayoutReadModel {
  context: DashboardContext;
  layout: {
    version: number;
    widgets: readonly ResolvedDashboardWidget[];
  };
  generatedAt: string;
}

/** Query aceita por `GET /dashboard` (`DashboardQueryDto`). */
export interface DashboardQuery {
  range?: DashboardRangeKey;
  /** Lista separada por vírgula no transporte. */
  tags?: string;
}

/** Query aceita pelos endpoints de `/analytics` (`AnalyticsQueryDto`). */
export interface AnalyticsQuery {
  from?: string;
  to?: string;
  granularity?: AnalyticsPeriod["granularity"];
  businessUnitId?: string;
}

/** Query aceita por `GET /scheduling/agenda` (`AgendaQueryDto`). */
export interface AgendaQuery {
  view: "DAY" | "WEEK" | "MONTH";
  date: string;
  businessUnitId?: string;
}

/* ------------------------------------------------------------------ */
/* Atividades recentes e próximos compromissos                         */
/* ------------------------------------------------------------------ */

/** `GET /dashboard/activity` e `/dashboard/upcoming`. */
export interface DashboardFeedItem {
  id: string;
  kind: "OPERATION" | "SERVICE_REQUEST" | "QUOTE" | "PMOC" | "RVT";
  event:
    | "CREATED"
    | "STARTED"
    | "COMPLETED"
    | "OPENED"
    | "APPROVED"
    | "REJECTED"
    | "SCHEDULED"
    | "DUE";
  entityType: string;
  entityId: string;
  code: string | null;
  title: string;
  customerName: string | null;
  personName: string | null;
  at: string;
  allDay: boolean;
}

export interface DashboardFeed {
  generatedAt: string;
  items: DashboardFeedItem[];
}

export interface DashboardFeedQuery {
  businessUnitId?: string;
  limit?: number;
  days?: number;
}
