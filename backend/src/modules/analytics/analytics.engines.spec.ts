import { EnvironmentalIntelligenceProvider } from '../dashboards/environmental-intelligence.provider';
import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsService } from './analytics.service';
import type {
  AnalyticsSnapshot,
  AnalyticsGranularity,
  AnalyticsRange,
} from './analytics.types';
import { EnvironmentalImpactEngine } from './engines/environmental-impact.engine';
import { ForecastEngine } from './engines/forecast.engine';
import { HealthEngine } from './engines/health.engine';
import { KpiEngine } from './engines/kpi.engine';
import { TrendEngine } from './engines/trend.engine';

type AnalyticsOperation = {
  id: string;
  status: string;
  scheduledEnd: Date | null;
  scheduledStart?: Date | null;
  responsibleFieldTechnicianId?: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  users: Array<{ user: { id: string; displayName: string } }>;
};

type AnalyticsCommitment = {
  status: string;
  /** Planned date, retained for the existing trend series. */
  createdAt: Date;
  deadlineAt?: Date;
  finalizedAt: Date | null;
};

type FixtureRows = {
  range: AnalyticsRange;
  operations: AnalyticsOperation[];
  previousOperations: AnalyticsOperation[];
  pmocs: AnalyticsCommitment[];
  previousPmocs?: AnalyticsCommitment[];
  rvts?: AnalyticsCommitment[];
  previousRvts?: AnalyticsCommitment[];
  assets: Array<{ status: string }>;
  customers: Array<{ status: string }>;
};

const completed = (status: string) =>
  ['COMPLETED', 'DONE', 'CLOSED', 'FINALIZED', 'PUBLISHED'].includes(status);
const cancelled = (status: string) =>
  ['CANCELLED', 'CANCELED'].includes(status);
const during = (date: Date | null | undefined, from: Date, to: Date) =>
  Boolean(date && date >= from && date <= to);

function operationStats(
  operations: AnalyticsOperation[],
  from: Date,
  to: Date,
) {
  const active = operations.filter(
    (op) => !cancelled(op.status) && op.createdAt <= to,
  );
  const cohort = active.filter((op) => during(op.createdAt, from, to));
  const delivered = active.filter(
    (op) => completed(op.status) && during(op.completedAt, from, to),
  );
  const withDeadline = delivered.filter((op) => op.scheduledEnd !== null);
  const open = active.filter((op) => !completed(op.status));
  return {
    cohort,
    delivered,
    withDeadline,
    open,
    onTime: withDeadline.filter((op) => op.completedAt! <= op.scheduledEnd!)
      .length,
    assigned: cohort.filter((op) => Boolean(op.responsibleFieldTechnicianId))
      .length,
    scheduled: cohort.filter((op) => Boolean(op.scheduledStart)).length,
    overdue: open.filter((op) => op.scheduledEnd && op.scheduledEnd < to)
      .length,
    openWithDeadline: open.filter((op) => op.scheduledEnd !== null).length,
    unassigned: open.filter((op) => !op.responsibleFieldTechnicianId).length,
    unscheduled: open.filter((op) => !op.scheduledStart).length,
  };
}

function commitments(rows: AnalyticsCommitment[], from: Date, to: Date) {
  const due = rows.filter(
    (row) => !cancelled(row.status) && (row.deadlineAt ?? row.createdAt) <= to,
  );
  const isDone = (row: AnalyticsCommitment) =>
    completed(row.status) && row.finalizedAt !== null && row.finalizedAt <= to;
  const evaluated = due.filter(
    (row) => (row.deadlineAt ?? row.createdAt) >= from || !isDone(row),
  );
  return {
    total: evaluated.length,
    overdue: due.filter((row) => !isDone(row)).length,
    onTime: evaluated.filter(
      (row) =>
        isDone(row) && row.finalizedAt! <= (row.deadlineAt ?? row.createdAt),
    ).length,
  };
}
function key(date: Date, granularity: AnalyticsGranularity) {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  if (granularity === 'WEEK')
    value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  if (granularity === 'MONTH') value.setUTCDate(1);
  return value.toISOString();
}
// Reference calculations on small hand-written fixtures. Production reads only
// aggregate results. The PostgreSQL E2E suite exercises actual source rows.
function summarize(data: FixtureRows): AnalyticsSnapshot {
  const { range, operations, previousOperations } = data;
  const totals = (rows: AnalyticsOperation[], from: Date, to: Date) => {
    const stats = operationStats(rows, from, to);
    return {
      ...stats,
      cohort: stats.cohort.length,
      delivered: stats.delivered.length,
      withDeadline: stats.withDeadline.length,
    };
  };
  const current = totals(operations, range.from, range.to);
  const previous = totals(
    previousOperations,
    range.previousFrom,
    range.previousTo,
  );
  const planned = operationStats(operations, range.from, range.to).cohort;
  const { open, overdue, openWithDeadline, unassigned, unscheduled } = current;
  const series = (dates: Date[]) => {
    const points = new Map<string, number>();
    for (const when of dates.filter((d) => during(d, range.from, range.to))) {
      const timestamp = key(when, range.granularity);
      points.set(timestamp, (points.get(timestamp) ?? 0) + 1);
    }
    return Array.from(points, ([timestamp, value]) => ({ timestamp, value }));
  };
  const visible = operations.filter((item) => !cancelled(item.status));
  return {
    range,
    operations: {
      current,
      previous,
      open: open.length,
      overdue,
      openWithDeadline,
      unassigned,
      unscheduled,
      completedCohort: planned.filter(
        (op) =>
          completed(op.status) && op.completedAt && op.completedAt <= range.to,
      ).length,
      activeTechnicians: new Set(
        planned.map((op) => op.responsibleFieldTechnicianId).filter(Boolean),
      ).size,
    },
    pmoc: {
      current: commitments(data.pmocs, range.from, range.to),
      previous: commitments(
        data.previousPmocs ?? [],
        range.previousFrom,
        range.previousTo,
      ),
    },
    rvt: {
      current: commitments(data.rvts ?? [], range.from, range.to),
      previous: commitments(
        data.previousRvts ?? [],
        range.previousFrom,
        range.previousTo,
      ),
    },
    equipmentRegistered: data.assets.length,
    trends: {
      created: series(visible.map((op) => op.createdAt)),
      completed: series(
        visible.flatMap((op) => (op.completedAt ? [op.completedAt] : [])),
      ),
      pmoc: series(data.pmocs.map((op) => op.createdAt)),
    },
  };
}

const date = (value: string) => new Date(value);
const operation = (
  overrides: Partial<AnalyticsOperation> = {},
): AnalyticsOperation => ({
  id: 'op',
  status: 'OPEN',
  scheduledStart: null,
  scheduledEnd: null,
  responsibleFieldTechnicianId: null,
  startedAt: null,
  completedAt: null,
  createdAt: date('2026-07-02T12:00:00Z'),
  users: [],
  ...overrides,
});
const snapshot = (overrides: Partial<FixtureRows> = {}): FixtureRows => ({
  range: {
    from: date('2026-07-01T00:00:00Z'),
    to: date('2026-07-07T23:59:59Z'),
    previousFrom: date('2026-06-24T00:00:00Z'),
    previousTo: date('2026-06-30T23:59:59Z'),
    granularity: 'DAY',
  },
  operations: [],
  previousOperations: [],
  pmocs: [],
  previousPmocs: [],
  rvts: [],
  previousRvts: [],
  assets: [],
  customers: [],
  ...overrides,
});
const engine = new KpiEngine();
const metric = (data: FixtureRows, id: string) =>
  engine.execute(summarize(data)).indicators.find((item) => item.id === id)!;
const health = (data: FixtureRows) =>
  new HealthEngine().execute(engine.execute(summarize(data)));

describe('Analytics facts and operational health', () => {
  it('does not assign health or invented performance to an empty organization', () => {
    const data = snapshot();
    expect(
      engine
        .execute(summarize(data))
        .indicators.every((item) => item.value === 0),
    ).toBe(true);
    expect(
      health(data).dimensions.every((item) => item.hasData === false),
    ).toBe(true);
    expect(health(data).score).toBe(0);
    expect(metric(data, 'operations.sla_compliance')).toMatchObject({
      sampleSize: 0,
      comparisonAvailable: false,
      basis: { numerator: 0, denominator: 0 },
    });
  });
  it('counts old open work, overdue deadlines and missing planning directly', () => {
    const data = snapshot({
      operations: [
        operation({
          createdAt: date('2025-01-01'),
          scheduledEnd: date('2026-06-01'),
        }),
        operation({
          id: 'future',
          scheduledEnd: date('2026-08-01'),
          responsibleFieldTechnicianId: 'technician',
          scheduledStart: date('2026-08-01'),
        }),
        operation({ id: 'cancel', status: 'CANCELLED' }),
      ],
    });
    expect(metric(data, 'operations.open').value).toBe(2);
    expect(metric(data, 'operations.overdue').value).toBe(1);
    expect(metric(data, 'operations.unassigned').value).toBe(1);
    expect(metric(data, 'operations.unscheduled').value).toBe(1);
    expect(metric(data, 'operations.total').value).toBe(1);
  });
  it('counts completions by delivery time, including orders created before the period', () => {
    const data = snapshot({
      operations: [
        operation({
          status: 'COMPLETED',
          createdAt: date('2025-01-01'),
          completedAt: date('2026-07-03'),
          scheduledEnd: date('2026-07-04'),
        }),
      ],
    });
    expect(metric(data, 'operations.completed').value).toBe(1);
    expect(metric(data, 'operations.open').value).toBe(0);
    expect(metric(data, 'operations.sla_compliance')).toMatchObject({
      value: 100,
      sampleSize: 1,
    });
  });
  it('uses only completed jobs with deadlines as the on-time denominator', () => {
    const data = snapshot({
      operations: [
        operation({
          status: 'COMPLETED',
          completedAt: date('2026-07-03'),
          scheduledEnd: date('2026-07-04'),
        }),
        operation({
          status: 'COMPLETED',
          completedAt: date('2026-07-03'),
          scheduledEnd: date('2026-07-02'),
        }),
        operation({ status: 'COMPLETED', completedAt: date('2026-07-03') }),
        operation({ scheduledEnd: date('2026-07-02') }),
      ],
    });
    expect(metric(data, 'operations.sla_compliance')).toMatchObject({
      value: 50,
      sampleSize: 2,
      basis: { numerator: 1, denominator: 2 },
    });
  });
  it('does not treat an auxiliary assignment as the operational responsible', () => {
    const data = snapshot({
      operations: [
        operation({
          users: [{ user: { id: 'aux', displayName: 'Auxiliar' } }],
        }),
      ],
    });
    expect(metric(data, 'operations.unassigned').value).toBe(1);
    expect(metric(data, 'technicians.assignment_coverage').value).toBe(0);
  });
  it('excludes cancelled operations from coverage, rather than lowering the rate', () => {
    const data = snapshot({
      operations: [
        operation({
          responsibleFieldTechnicianId: 'tech',
          scheduledStart: date('2026-07-03'),
        }),
        operation({ status: 'CANCELLED' }),
      ],
    });
    expect(metric(data, 'technicians.assignment_coverage')).toMatchObject({
      value: 100,
      sampleSize: 1,
    });
    expect(metric(data, 'operations.scheduling_coverage').value).toBe(100);
  });
  it('includes unresolved maintenance before the period but never counts future commitments as failures', () => {
    const data = snapshot({
      pmocs: [
        { status: 'PENDING', createdAt: date('2025-01-01'), finalizedAt: null },
        { status: 'PENDING', createdAt: date('2026-08-01'), finalizedAt: null },
        {
          status: 'CANCELLED',
          createdAt: date('2026-07-02'),
          finalizedAt: null,
        },
      ],
    });
    expect(metric(data, 'pmoc.overdue').value).toBe(1);
    expect(metric(data, 'pmoc.compliance')).toMatchObject({
      value: 0,
      sampleSize: 1,
    });
    expect(health(data).score).toBe(0);
    expect(
      health(data).dimensions.find((item) => item.id === 'pmoc'),
    ).toMatchObject({ hasData: true });
  });
  it('measures PMOC and RVT deadlines using actual completion timestamps', () => {
    const due = date('2026-07-03T23:59:59Z');
    const data = snapshot({
      pmocs: [
        {
          status: 'COMPLETED',
          createdAt: date('2026-07-03'),
          deadlineAt: due,
          finalizedAt: date('2026-07-03T15:00:00Z'),
        },
        {
          status: 'COMPLETED',
          createdAt: date('2026-07-03'),
          deadlineAt: due,
          finalizedAt: date('2026-07-04'),
        },
      ],
      rvts: [
        {
          status: 'COMPLETED',
          createdAt: due,
          finalizedAt: date('2026-07-03T18:00:00Z'),
        },
      ],
    });
    expect(metric(data, 'pmoc.compliance')).toMatchObject({
      value: 50,
      sampleSize: 2,
    });
    expect(metric(data, 'rvt.compliance')).toMatchObject({
      value: 100,
      sampleSize: 1,
    });
  });
  it('does not invent growth against an empty previous period and labels rate changes in percentage points', () => {
    const data = snapshot({
      operations: [operation({ scheduledStart: date('2026-07-03') })],
      previousOperations: [operation({ createdAt: date('2026-06-25') })],
    });
    expect(metric(data, 'operations.completed').comparisonAvailable).toBe(
      false,
    );
    expect(metric(data, 'operations.scheduling_coverage')).toMatchObject({
      changePercent: 100,
      changeUnit: 'POINTS',
      comparisonAvailable: true,
    });
  });
  it('removes the customer-as-contract proxy and does not use cadastral equipment status as health', () => {
    const data = snapshot({
      customers: [{ status: 'ACTIVE' }],
      assets: [{ status: 'ACTIVE' }],
    });
    expect(
      engine
        .execute(summarize(data))
        .indicators.some(
          (item) =>
            item.id === 'contracts.active_proxy' ||
            item.id === 'equipment.availability',
        ),
    ).toBe(false);
    expect(health(data).score).toBe(0);
  });
  it('keeps health independent from simulated weather and normalizes only measured dimensions', () => {
    const data = snapshot({
      operations: [
        operation({
          scheduledStart: date('2026-07-03'),
          responsibleFieldTechnicianId: 'tech',
        }),
      ],
    });
    const kpis = engine.execute(summarize(data));
    const environment = new EnvironmentalImpactEngine().execute(
      new EnvironmentalIntelligenceProvider().read(),
    );
    const measured = new HealthEngine().execute(kpis);
    expect(new HealthEngine().execute(kpis, environment).score).toBe(
      measured.score,
    );
    expect(measured.score).toBe(100);
    expect(
      measured.dimensions.reduce((sum, item) => sum + item.weight, 0),
    ).toBe(1);
  });
  it('exposes eight executive indicators while retaining supplementary API metrics', () => {
    expect(
      engine
        .execute(summarize(snapshot()))
        .indicators.filter((item) => item.executive)
        .map((item) => item.id),
    ).toEqual([
      'operations.open',
      'operations.overdue',
      'operations.unassigned',
      'operations.unscheduled',
      'operations.completed',
      'operations.sla_compliance',
      'pmoc.overdue',
      'rvt.overdue',
    ]);
  });
  it('retains actual completion dates in trends and forecasts', () => {
    const data = snapshot({
      operations: [
        operation({
          createdAt: date('2025-01-01'),
          completedAt: date('2026-07-03'),
          status: 'COMPLETED',
        }),
      ],
    });
    const trends = new TrendEngine().execute(summarize(data));
    expect(trends.series[0]!.points).toHaveLength(7);
    expect(
      trends.series[0]!.points.reduce((sum, item) => sum + item.value, 0),
    ).toBe(0);
    expect(
      trends.series[1]!.points.reduce((sum, item) => sum + item.value, 0),
    ).toBe(1);
    expect(new ForecastEngine().execute(trends).forecasts).toHaveLength(3);
  });
  it('does not count records outside the period even when they share a chart bucket', () => {
    const data = snapshot({
      range: {
        ...snapshot().range,
        from: date('2026-07-01T03:00:00Z'),
        granularity: 'MONTH',
      },
      operations: [
        operation({ createdAt: date('2026-07-01T02:00:00Z') }),
        operation({ status: 'CANCELLED' }),
      ],
    });
    expect(
      new TrendEngine().execute(summarize(data)).series[0]!.points[0]?.value,
    ).toBe(0);
  });
  it('does not publish a zero health score or simulated weather risks when there is no basis', async () => {
    const service = new AnalyticsService(
      {
        snapshot: jest.fn().mockResolvedValue(summarize(snapshot())),
      } as unknown as AnalyticsRepository,
      new EnvironmentalIntelligenceProvider(),
      new KpiEngine(),
      new TrendEngine(),
      new HealthEngine(),
      new ForecastEngine(),
      new EnvironmentalImpactEngine(),
    );
    expect((await service.dashboard('org', {}, ['*'])).headline).toMatchObject({
      healthScore: null,
      slaCompliance: null,
      openOperations: 0,
      equipmentAvailability: null,
    });
    expect(await service.intelligenceContext('org', {}, ['*'])).toMatchObject({
      healthScore: null,
      priorities: [],
      risks: [],
    });
  });
});
