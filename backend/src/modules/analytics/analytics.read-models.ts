import type { WeatherEnvironmentalIntelligenceReadModel } from '../dashboards/dashboard.read-models';

export type AnalyticsDomain =
  | 'OPERATIONS'
  | 'PMOC'
  | 'EQUIPMENT'
  | 'TECHNICIANS'
  | 'CONTRACTS'
  | 'ENVIRONMENT';
export type AnalyticsDirection = 'UP' | 'DOWN' | 'STABLE';
export type AnalyticsStatus = 'HEALTHY' | 'ATTENTION' | 'CRITICAL';

export type AnalyticsDomainAvailability = {
  domain: AnalyticsDomain;
  available: boolean;
  requiredCapabilities: readonly string[];
  missingCapabilities: readonly string[];
  blockedReason: 'MISSING_DOMAIN_CAPABILITY' | null;
};

export type AnalyticsPeriod = {
  from: string;
  to: string;
  granularity: 'DAY' | 'WEEK' | 'MONTH';
};

export type AnalyticsKpi = {
  id: string;
  domain: AnalyticsDomain;
  label: string;
  value: number;
  unit?: string;
  target?: number;
  status: AnalyticsStatus;
  direction: AnalyticsDirection;
  changePercent: number;
  source: string;
  dataQuality: 'OBSERVED' | 'DERIVED' | 'PROXY' | 'MOCK';
  /** Number of source records; zero means there is nothing to evaluate. */
  sampleSize?: number;
};

export type KpiReadModel = {
  generatedAt: string;
  period: AnalyticsPeriod;
  availability: readonly AnalyticsDomainAvailability[];
  indicators: AnalyticsKpi[];
};

export type TrendPoint = { timestamp: string; value: number };
export type AnalyticsTrend = {
  id: string;
  domain: AnalyticsDomain;
  label: string;
  unit?: string;
  direction: AnalyticsDirection;
  changePercent: number;
  points: TrendPoint[];
};
export type TrendReadModel = {
  generatedAt: string;
  period: AnalyticsPeriod;
  availability: readonly AnalyticsDomainAvailability[];
  series: AnalyticsTrend[];
};

export type HealthDimension = {
  id: string;
  domain: AnalyticsDomain;
  label: string;
  score: number;
  weight: number;
  status: AnalyticsStatus;
  drivers: string[];
  hasData?: boolean;
};
export type AnalyticsHealthReadModel = {
  generatedAt: string;
  score: number;
  status: AnalyticsStatus;
  availability: readonly AnalyticsDomainAvailability[];
  dimensions: HealthDimension[];
};

export type AnalyticsForecast = {
  id: string;
  domain: AnalyticsDomain;
  label: string;
  unit?: string;
  method: 'LINEAR_REGRESSION' | 'MOVING_AVERAGE';
  horizon: string;
  confidence: number;
  projected: TrendPoint[];
};
export type ForecastReadModel = {
  generatedAt: string;
  availability: readonly AnalyticsDomainAvailability[];
  forecasts: AnalyticsForecast[];
};

export type EnvironmentalImpactReadModel = {
  generatedAt: string;
  source: 'MOCK_DERIVED';
  indicators: {
    coolingLoadIndex: number;
    fieldWorkRiskIndex: number;
    delayRiskPercent: number;
    equipmentStressIndex: number;
  };
  impacts: string[];
  recommendations: string[];
  environment: WeatherEnvironmentalIntelligenceReadModel;
};

export type AnalyticsOverviewReadModel = {
  generatedAt: string;
  period: AnalyticsPeriod;
  availability: readonly AnalyticsDomainAvailability[];
  kpis: KpiReadModel;
  trends: TrendReadModel;
  health: AnalyticsHealthReadModel;
  forecasts: ForecastReadModel;
  environmentalImpact: EnvironmentalImpactReadModel;
};

export type AnalyticsDashboardReadModel = {
  generatedAt: string;
  availability: readonly AnalyticsDomainAvailability[];
  headline: {
    healthScore: number;
    openOperations: number | null;
    slaCompliance: number | null;
    equipmentAvailability: number | null;
  };
  metrics: AnalyticsKpi[];
  series: AnalyticsTrend[];
  forecasts: AnalyticsForecast[];
  environmentalImpact: EnvironmentalImpactReadModel['indicators'];
};

/** Stable, UI-agnostic input contract for Orbit Intelligence. */
export type OrbitIntelligenceAnalyticsContext = {
  generatedAt: string;
  availability: readonly AnalyticsDomainAvailability[];
  healthScore: number;
  priorities: Array<{
    domain: AnalyticsDomain;
    indicator: string;
    status: AnalyticsStatus;
    value: number;
  }>;
  risks: string[];
  trends: Array<{
    id: string;
    direction: AnalyticsDirection;
    changePercent: number;
  }>;
  forecasts: Array<{ id: string; nextValue: number; confidence: number }>;
  environmental: EnvironmentalImpactReadModel['indicators'];
};
