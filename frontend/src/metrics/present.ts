/**
 * Apresentação de métricas.
 *
 * Converte o contrato do backend (`AnalyticsKpi`) em tudo que a interface
 * precisa: rótulo, valor formatado, variação, leitura da tendência, status e
 * sinalização de procedência.
 *
 * É a única porta que os componentes usam. Nenhum deles decide ícone, cor,
 * formato ou marca de procedência por conta própria.
 */
import type {
  AnalyticsDirection,
  AnalyticsKpi,
  AnalyticsStatus,
  DataQuality,
} from "@/types/dashboard";
import {
  formatMetricValue,
  provenanceMarkFor,
  resolveMetric,
  type MetricDefinition,
  type MetricIcon,
  type ProvenanceMark,
  type TrendTone,
} from "./metric-registry";

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export interface PresentedMetric {
  id: string;
  definition: MetricDefinition;
  label: string;
  description: string;
  icon: MetricIcon;
  iconColor: string;
  /** Valor já formatado pela unidade da métrica. */
  value: string;
  /** Meta formatada, quando o backend a publica. */
  target?: string;
  /** Variação formatada; ausente quando o backend não informa mudança. */
  change?: string;
  direction: AnalyticsDirection;
  trendTone: TrendTone;
  status: AnalyticsStatus;
  statusLabel?: string;
  provenance: {
    quality: DataQuality;
    mark: ProvenanceMark;
    /** Origem técnica declarada pelo backend (ex.: `operation_users`). */
    source: string;
  };
}

/**
 * Apresenta um indicador do Analytics.
 *
 * O rótulo do registry tem precedência sobre o do backend: é a versão curada
 * para a interface. Quando a métrica não está registrada, o rótulo do backend
 * é usado.
 */
export function presentMetric(kpi: AnalyticsKpi): PresentedMetric {
  const definition = resolveMetric({
    id: kpi.id,
    label: kpi.label,
    unit: kpi.unit,
    domain: kpi.domain,
  });

  return {
    id: kpi.id,
    definition,
    label: definition.label,
    description:
      (kpi.basis && kpi.basis.denominator > 0
        ? `${kpi.basis.numerator} de ${kpi.basis.denominator}. `
        : "") + (kpi.description ?? definition.description),
    icon: definition.icon,
    iconColor: definition.color,
    value:
      kpi.unit === "%" && kpi.sampleSize === 0
        ? "—"
        : formatMetricValue(definition, kpi.value),
    target:
      kpi.target === undefined
        ? undefined
        : formatMetricValue(definition, kpi.target),
    change:
      kpi.comparisonAvailable === false
        ? undefined
        : kpi.changeUnit === "POINTS"
          ? kpi.changePercent
            ? `${kpi.changePercent > 0 ? "+" : ""}${decimal.format(kpi.changePercent)} p.p.`
            : undefined
          : formatChangePercent(kpi.changePercent),
    direction: kpi.direction,
    trendTone: definition.trendColor(kpi.direction),
    status: kpi.status,
    statusLabel:
      kpi.unit === "%" && kpi.sampleSize === 0
        ? "Sem base de cálculo"
        : kpi.unit !== "%" &&
            ![
              "operations.overdue",
              "operations.unassigned",
              "operations.unscheduled",
              "pmoc.overdue",
              "rvt.overdue",
            ].includes(kpi.id)
          ? "Informativo"
          : undefined,
    provenance: {
      quality: kpi.dataQuality,
      mark: provenanceMarkFor(definition, kpi.dataQuality),
      source: kpi.source,
    },
  };
}

/**
 * Apresenta um valor solto que não vem como `AnalyticsKpi`.
 *
 * Usado pelos indicadores ambientais, que o backend publica como números nus
 * dentro de `EnvironmentalImpactReadModel.indicators`.
 */
export function presentValue(
  metricId: string,
  value: number,
  options: { quality?: DataQuality } = {},
): PresentedMetric {
  const definition = resolveMetric({ id: metricId });
  const quality = options.quality ?? "DERIVED";
  return {
    id: metricId,
    definition,
    label: definition.label,
    description: definition.description,
    icon: definition.icon,
    iconColor: definition.color,
    value: formatMetricValue(definition, value),
    direction: "STABLE",
    trendTone: "neutral",
    status: "HEALTHY",
    provenance: {
      quality,
      mark: provenanceMarkFor(definition, quality),
      source: "analytics.environmental-impact",
    },
  };
}

/** Variação percentual já calculada pelo backend. */
export function formatChangePercent(changePercent: number): string | undefined {
  if (!Number.isFinite(changePercent) || changePercent === 0) return undefined;
  const sign = changePercent > 0 ? "+" : "";
  return `${sign}${decimal.format(changePercent)}%`;
}

export const STATUS_LABELS: Readonly<Record<AnalyticsStatus, string>> = {
  HEALTHY: "Saudável",
  ATTENTION: "Atenção",
  CRITICAL: "Crítico",
};

export const STATUS_CLASSES: Readonly<Record<AnalyticsStatus, string>> = {
  HEALTHY: "bg-success/15 text-success",
  ATTENTION: "bg-warning/15 text-warning",
  CRITICAL: "bg-destructive/15 text-destructive",
};
