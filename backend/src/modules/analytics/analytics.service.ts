import { Injectable } from '@nestjs/common';
import { ValidationException } from '../../exceptions';
import { EnvironmentalIntelligenceProvider } from '../dashboards/environmental-intelligence.provider';
import type { AnalyticsReadPort } from './analytics.port';
import type {
  AnalyticsDashboardReadModel,
  AnalyticsOverviewReadModel,
  AnalyticsPanelReadModel,
  OrbitIntelligenceAnalyticsContext,
} from './analytics.read-models';
import { AnalyticsRepository } from './analytics.repository';
import type { AnalyticsRange } from './analytics.types';
import type { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { EnvironmentalImpactEngine } from './engines/environmental-impact.engine';
import { analyticsAccess } from './analytics-authorization';
import { ForecastEngine } from './engines/forecast.engine';
import { HealthEngine } from './engines/health.engine';
import { KpiEngine } from './engines/kpi.engine';
import { TrendEngine } from './engines/trend.engine';

/** Thin application orchestrator; all calculations live in specialized engines. */
@Injectable()
export class AnalyticsService implements AnalyticsReadPort {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly environmentalProvider: EnvironmentalIntelligenceProvider,
    private readonly kpiEngine: KpiEngine,
    private readonly trendEngine: TrendEngine,
    private readonly healthEngine: HealthEngine,
    private readonly forecastEngine: ForecastEngine,
    private readonly environmentalImpactEngine: EnvironmentalImpactEngine,
  ) {}

  async overview(
    organizationId: string,
    query: AnalyticsQueryDto,
    permissions: readonly string[],
  ): Promise<AnalyticsOverviewReadModel> {
    const { snapshot, access, kpis } = await this.readKpis(
      organizationId,
      query,
      permissions,
      true,
    );
    const rawTrends = this.trendEngine.execute(snapshot);
    const trends = {
      ...rawTrends,
      availability: access.availability,
      series: rawTrends.series.filter((item) =>
        access.domains.has(item.domain),
      ),
    };
    const environmentalImpact = this.environmentalImpact();
    const health = this.healthEngine.execute(kpis);
    const forecasts = this.forecastEngine.execute(trends);
    return {
      generatedAt: new Date().toISOString(),
      period: kpis.period,
      availability: access.availability,
      kpis,
      trends,
      health: { ...health, availability: access.availability },
      forecasts,
      environmentalImpact,
    };
  }

  private async readKpis(
    organizationId: string,
    query: AnalyticsQueryDto,
    permissions: readonly string[],
    includeTrends: boolean,
  ) {
    const access = analyticsAccess(permissions);
    const snapshot = await this.repository.snapshot(
      organizationId,
      this.range(query),
      access.domains,
      includeTrends,
    );
    const raw = this.kpiEngine.execute(snapshot);
    return {
      snapshot,
      access,
      kpis: {
        ...raw,
        availability: access.availability,
        indicators: raw.indicators.filter((item) =>
          access.domains.has(item.domain),
        ),
      },
    };
  }

  async kpis(
    organizationId: string,
    query: AnalyticsQueryDto,
    permissions: readonly string[],
  ) {
    return (await this.readKpis(organizationId, query, permissions, false))
      .kpis;
  }
  async trends(
    organizationId: string,
    query: AnalyticsQueryDto,
    permissions: readonly string[],
  ) {
    return (await this.overview(organizationId, query, permissions)).trends;
  }
  async health(
    organizationId: string,
    query: AnalyticsQueryDto,
    permissions: readonly string[],
  ) {
    const { kpis } = await this.readKpis(
      organizationId,
      query,
      permissions,
      false,
    );
    return {
      ...this.healthEngine.execute(kpis),
      availability: kpis.availability,
    };
  }
  async forecasts(
    organizationId: string,
    query: AnalyticsQueryDto,
    permissions: readonly string[],
  ) {
    return (await this.overview(organizationId, query, permissions)).forecasts;
  }
  environmentalImpact() {
    return this.environmentalImpactEngine.execute(
      this.environmentalProvider.read(),
    );
  }

  async dashboard(
    organizationId: string,
    query: AnalyticsQueryDto,
    permissions: readonly string[],
  ): Promise<AnalyticsDashboardReadModel> {
    return this.dashboardOf(
      await this.overview(organizationId, query, permissions),
    );
  }

  async panel(
    organizationId: string,
    query: AnalyticsQueryDto,
    permissions: readonly string[],
    includeIntelligence: boolean,
  ): Promise<AnalyticsPanelReadModel> {
    const model = await this.overview(organizationId, query, permissions);
    return {
      dashboard: this.dashboardOf(model),
      health: model.health,
      intelligence: includeIntelligence ? this.intelligenceOf(model) : null,
    };
  }

  private dashboardOf(
    model: AnalyticsOverviewReadModel,
  ): AnalyticsDashboardReadModel {
    const metric = (id: string) => {
      const item = model.kpis.indicators.find((item) => item.id === id);
      return item?.unit === '%' && item.sampleSize === 0
        ? null
        : (item?.value ?? null);
    };

    return {
      generatedAt: model.generatedAt,
      availability: model.availability,
      headline: {
        healthScore: model.health.dimensions.some((item) => item.hasData)
          ? model.health.score
          : null,
        openOperations: metric('operations.open'),
        slaCompliance: metric('operations.sla_compliance'),
        equipmentAvailability: metric('equipment.availability'),
      },
      metrics: model.kpis.indicators,
      series: model.trends.series,
      forecasts: model.forecasts.forecasts,
      environmentalImpact: model.environmentalImpact.indicators,
    };
  }

  async intelligenceContext(
    organizationId: string,
    query: AnalyticsQueryDto,
    permissions: readonly string[],
  ): Promise<OrbitIntelligenceAnalyticsContext> {
    return this.intelligenceOf(
      await this.overview(organizationId, query, permissions),
    );
  }

  private intelligenceOf(
    model: AnalyticsOverviewReadModel,
  ): OrbitIntelligenceAnalyticsContext {
    return {
      generatedAt: model.generatedAt,
      availability: model.availability,
      healthScore: model.health.dimensions.some((item) => item.hasData)
        ? model.health.score
        : null,
      priorities: model.kpis.indicators
        .filter(
          (item) => item.status !== 'HEALTHY' && (item.sampleSize ?? 0) > 0,
        )
        .map((item) => ({
          domain: item.domain,
          indicator: item.id,
          status: item.status,
          value: item.value,
        })),
      // Environmental impacts are currently MOCK_DERIVED. They remain in the
      // explicitly simulated environmental panel, never in operational risks.
      risks: model.health.dimensions
        .filter((item) => item.status !== 'HEALTHY' && item.hasData)
        .map((item) => `${item.label}: ${item.drivers.join(', ')}`),
      trends: model.trends.series.map((item) => ({
        id: item.id,
        direction: item.direction,
        changePercent: item.changePercent,
      })),
      forecasts: model.forecasts.forecasts.map((item) => ({
        id: item.id,
        nextValue: item.projected[0]?.value ?? 0,
        confidence: item.confidence,
      })),
      environmental: model.environmentalImpact.indicators,
    };
  }

  private range(query: AnalyticsQueryDto): AnalyticsRange {
    const now = new Date();
    const requestedTo = query.to ? new Date(query.to) : now;
    const to = new Date(Math.min(requestedTo.getTime(), now.getTime()));
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - 30 * 86_400_000);
    if (from >= to)
      throw new ValidationException('Analytics from must be before to');
    const duration = to.getTime() - from.getTime();
    if (duration > 366 * 86_400_000)
      throw new ValidationException('Analytics range cannot exceed 366 days');
    const granularity =
      query.granularity ??
      (duration > 120 * 86_400_000
        ? 'MONTH'
        : duration > 45 * 86_400_000
          ? 'WEEK'
          : 'DAY');
    return {
      from,
      to,
      previousFrom: new Date(from.getTime() - duration - 1),
      previousTo: new Date(from.getTime() - 1),
      granularity,
      businessUnitId: query.businessUnitId,
    };
  }
}
