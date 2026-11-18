/**
 * Serviços do Dashboard.
 *
 * Separação deliberada de responsabilidades, ditada pelo backend:
 *
 * - **`GET /dashboard`** resolve *quais* widgets o tenant enxerga. A resolução
 *   (segmento × módulos do plano × plano × permissões, além de ordem, tamanho
 *   e categoria) é lógica real do `WidgetResolver`. É a autoridade de layout.
 * - **`/analytics/*`** produz os *números*. É o único conjunto de endpoints
 *   que agrega fatos do banco sob RLS (`AnalyticsRepository.snapshot`).
 * - **`/scheduling/agenda`** fornece os eventos reais da agenda.
 *
 * O campo `data` de cada widget em `GET /dashboard` **não** é consumido: o
 * `DashboardRepository.read()` devolve fixtures fixas no código do backend
 * (apenas `context()` consulta o banco). Renderizá-lo apresentaria dados
 * inventados como observação real. Ver `docs/dashboard.md`.
 */
import { apiClient } from "@/api/client";
import { queryKeys, type QueryKey } from "@/api/query-keys";
import type { QueryParams, RequestOptions } from "@/types/api";
import type {
  AnalyticsDashboardReadModel,
  AnalyticsPanelReadModel,
  AnalyticsHealthReadModel,
  AnalyticsQuery,
  AnalyticsTrendReadModel,
  DashboardLayoutReadModel,
  DashboardQuery,
  EnvironmentalImpactReadModel,
  ForecastReadModel,
  KpiReadModel,
  OrbitIntelligenceAnalyticsContext,
} from "@/types/dashboard";

const DASHBOARD_RESOURCE = "dashboard";
const ANALYTICS_RESOURCE = "analytics";
const asParams = (query: object | undefined): QueryParams | undefined =>
  query as QueryParams | undefined;

export const dashboardService = {
  /** Layout resolvido para o tenant: quais widgets, em que ordem. */
  layout: (
    query?: DashboardQuery,
    options?: RequestOptions,
  ): Promise<DashboardLayoutReadModel> =>
    apiClient.get<DashboardLayoutReadModel>("/dashboard", {
      ...options,
      query: asParams(query),
    }),

  keys: {
    module: (): QueryKey => queryKeys.module(DASHBOARD_RESOURCE),
    layout: (query?: DashboardQuery): QueryKey =>
      queryKeys.query(DASHBOARD_RESOURCE, "layout", asParams(query)),
  },
} as const;

export const analyticsService = {
  /** Read Model compacto: headline, KPIs, séries, projeções e ambiente. */
  dashboard: (
    query?: AnalyticsQuery,
    options?: RequestOptions,
  ): Promise<AnalyticsDashboardReadModel> =>
    apiClient.get<AnalyticsDashboardReadModel>("/analytics/dashboard", {
      ...options,
      query: asParams(query),
    }),

  panel: (query: AnalyticsQuery, options?: RequestOptions) =>
    apiClient.get<AnalyticsPanelReadModel>("/analytics/panel", {
      ...options,
      query: asParams(query),
    }),

  kpis: (
    query?: AnalyticsQuery,
    options?: RequestOptions,
  ): Promise<KpiReadModel> =>
    apiClient.get<KpiReadModel>("/analytics/kpis", {
      ...options,
      query: asParams(query),
    }),

  trends: (
    query?: AnalyticsQuery,
    options?: RequestOptions,
  ): Promise<AnalyticsTrendReadModel> =>
    apiClient.get<AnalyticsTrendReadModel>("/analytics/trends", {
      ...options,
      query: asParams(query),
    }),

  health: (
    query?: AnalyticsQuery,
    options?: RequestOptions,
  ): Promise<AnalyticsHealthReadModel> =>
    apiClient.get<AnalyticsHealthReadModel>("/analytics/health", {
      ...options,
      query: asParams(query),
    }),

  forecasts: (
    query?: AnalyticsQuery,
    options?: RequestOptions,
  ): Promise<ForecastReadModel> =>
    apiClient.get<ForecastReadModel>("/analytics/forecasts", {
      ...options,
      query: asParams(query),
    }),

  /** Não aceita query: o backend ignora período neste endpoint. */
  environmentalImpact: (
    options?: RequestOptions,
  ): Promise<EnvironmentalImpactReadModel> =>
    apiClient.get<EnvironmentalImpactReadModel>(
      "/analytics/environmental-impact",
      options,
    ),

  intelligence: (
    query?: AnalyticsQuery,
    options?: RequestOptions,
  ): Promise<OrbitIntelligenceAnalyticsContext> =>
    apiClient.get<OrbitIntelligenceAnalyticsContext>(
      "/analytics/intelligence",
      {
        ...options,
        query: asParams(query),
      },
    ),

  keys: {
    module: (): QueryKey => queryKeys.module(ANALYTICS_RESOURCE),
    dashboard: (query?: AnalyticsQuery): QueryKey =>
      queryKeys.query(ANALYTICS_RESOURCE, "dashboard", asParams(query)),
    panel: (query: AnalyticsQuery): QueryKey =>
      queryKeys.query(ANALYTICS_RESOURCE, "panel", asParams(query)),
    kpis: (query?: AnalyticsQuery): QueryKey =>
      queryKeys.query(ANALYTICS_RESOURCE, "kpis", asParams(query)),
    trends: (query?: AnalyticsQuery): QueryKey =>
      queryKeys.query(ANALYTICS_RESOURCE, "trends", asParams(query)),
    health: (query?: AnalyticsQuery): QueryKey =>
      queryKeys.query(ANALYTICS_RESOURCE, "health", asParams(query)),
    forecasts: (query?: AnalyticsQuery): QueryKey =>
      queryKeys.query(ANALYTICS_RESOURCE, "forecasts", asParams(query)),
    environmentalImpact: (): QueryKey =>
      queryKeys.query(ANALYTICS_RESOURCE, "environmental-impact"),
    intelligence: (query?: AnalyticsQuery): QueryKey =>
      queryKeys.query(ANALYTICS_RESOURCE, "intelligence", asParams(query)),
  },
} as const;

/**
 * Scheduling consumido pelo Dashboard.
 *
 * A superfície completa do módulo mora em `scheduling.service.ts` desde a
 * PR-07; este reexporte mantém os imports existentes e evita duas definições
 * do mesmo serviço.
 */
export { schedulingService } from "./scheduling.service";
