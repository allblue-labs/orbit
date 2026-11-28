import { Injectable } from '@nestjs/common';
import type {
  AnalyticsTrend,
  TrendPoint,
  TrendReadModel,
} from '../analytics.read-models';
import { change, direction } from '../analytics.math';
import type {
  AnalyticsGranularity,
  AnalyticsSnapshot,
} from '../analytics.types';

@Injectable()
export class TrendEngine {
  execute(snapshot: AnalyticsSnapshot): TrendReadModel {
    const created = this.bucket(snapshot.trends.created, snapshot);
    const completed = this.bucket(snapshot.trends.completed, snapshot);
    const pmocs = this.bucket(snapshot.trends.pmoc, snapshot);
    return {
      generatedAt: new Date().toISOString(),
      period: {
        from: snapshot.range.from.toISOString(),
        to: snapshot.range.to.toISOString(),
        granularity: snapshot.range.granularity,
      },
      availability: [],
      series: [
        this.series(
          'operations.created',
          'OPERATIONS',
          'Operações criadas',
          created,
        ),
        this.series(
          'operations.completed',
          'OPERATIONS',
          'Operações concluídas',
          completed,
        ),
        this.series('pmoc.generated', 'PMOC', 'Ciclos PMOC previstos', pmocs),
      ],
    };
  }

  private series(
    id: string,
    domain: AnalyticsTrend['domain'],
    label: string,
    points: TrendPoint[],
  ): AnalyticsTrend {
    const middle = Math.max(1, Math.floor(points.length / 2));
    const first = points
      .slice(0, middle)
      .reduce((sum, point) => sum + point.value, 0);
    const last = points
      .slice(middle)
      .reduce((sum, point) => sum + point.value, 0);
    const delta = change(last, first);
    return {
      id,
      domain,
      label,
      direction: direction(delta),
      changePercent: delta,
      points,
    };
  }

  private bucket(
    points: TrendPoint[],
    snapshot: AnalyticsSnapshot,
  ): TrendPoint[] {
    const result = new Map<string, number>();
    for (
      let cursor = new Date(snapshot.range.from);
      cursor <= snapshot.range.to;
      cursor = this.next(cursor, snapshot.range.granularity)
    ) {
      result.set(this.key(cursor, snapshot.range.granularity), 0);
    }
    for (const { timestamp, value } of points) {
      if (result.has(timestamp)) result.set(timestamp, value);
    }
    return [...result].map(([timestamp, value]) => ({ timestamp, value }));
  }

  private next(date: Date, granularity: AnalyticsGranularity) {
    const next = new Date(date);
    if (granularity === 'DAY') next.setUTCDate(next.getUTCDate() + 1);
    else if (granularity === 'WEEK') next.setUTCDate(next.getUTCDate() + 7);
    else next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }

  private key(date: Date, granularity: AnalyticsGranularity) {
    const value = new Date(date);
    value.setUTCHours(0, 0, 0, 0);
    if (granularity === 'WEEK')
      value.setUTCDate(value.getUTCDate() - value.getUTCDay());
    if (granularity === 'MONTH') value.setUTCDate(1);
    return value.toISOString();
  }
}
