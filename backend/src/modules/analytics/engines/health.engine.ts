import { Injectable } from '@nestjs/common';
import type {
  AnalyticsHealthReadModel,
  EnvironmentalImpactReadModel,
  HealthDimension,
  KpiReadModel,
} from '../analytics.read-models';
import { round, statusFor } from '../analytics.math';

/** Health measures actual pending work and service commitments, never proxies or weather. */
@Injectable()
export class HealthEngine {
  execute(
    kpis: KpiReadModel,
    _environment?: EnvironmentalImpactReadModel,
  ): AnalyticsHealthReadModel {
    // Older callers pass environmental data; it must never influence health.
    void _environment;
    const definitions = [
      [
        'operations',
        'operations.backlog_punctuality',
        'Fila no prazo',
        'no prazo',
      ],
      [
        'scheduling',
        'operations.backlog_scheduling',
        'Fila com agenda',
        'com agenda',
      ],
      [
        'technicians',
        'technicians.backlog_coverage',
        'Fila com técnico',
        'com técnico',
      ],
      ['pmoc', 'pmoc.compliance', 'PMOC em dia', 'ciclos no prazo'],
      ['rvt', 'rvt.compliance', 'RVT em dia', 'visitas no prazo'],
    ] as const;
    const dimensions: HealthDimension[] = definitions.flatMap(
      ([id, metricId, label, basis]) => {
        const metric = kpis.indicators.find((item) => item.id === metricId);
        if (!metric) return [];
        const hasData = (metric.sampleSize ?? 0) > 0;
        return [
          {
            id,
            label,
            domain: metric.domain,
            hasData,
            score: hasData ? metric.value : 0,
            weight: 0,
            status: metric.status,
            drivers:
              hasData && metric.basis
                ? [
                    `${metric.basis.numerator} de ${metric.basis.denominator} ${basis}`,
                    ...(metric.basis.denominator > metric.basis.numerator
                      ? [
                          `${metric.basis.denominator - metric.basis.numerator} precisam de atenção`,
                        ]
                      : []),
                  ]
                : [],
          },
        ];
      },
    );
    const measured = dimensions.filter((item) => item.hasData).length;
    for (const dimension of dimensions)
      dimension.weight = dimension.hasData ? 1 / measured : 0;
    const score = this.score(dimensions);
    return {
      generatedAt: new Date().toISOString(),
      score,
      status: statusFor(score, 90, 70),
      availability: [],
      dimensions,
    };
  }

  score(dimensions: HealthDimension[]): number {
    const measured = dimensions.filter((item) => item.hasData);
    const weight = measured.reduce((sum, item) => sum + item.weight, 0);
    return weight
      ? round(
          measured.reduce((sum, item) => sum + item.score * item.weight, 0) /
            weight,
        )
      : 0;
  }
}
