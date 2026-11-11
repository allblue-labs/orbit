import { EnvironmentalIntelligenceProvider } from '../dashboards/environmental-intelligence.provider';
import { AnalyticsRepository } from './analytics.repository';
import { AnalyticsService } from './analytics.service';
import type { AnalyticsOperation, AnalyticsSnapshot } from './analytics.types';
import { EnvironmentalImpactEngine } from './engines/environmental-impact.engine';
import { ForecastEngine } from './engines/forecast.engine';
import { HealthEngine } from './engines/health.engine';
import { KpiEngine } from './engines/kpi.engine';
import { TrendEngine } from './engines/trend.engine';

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
const snapshot = (
  overrides: Partial<AnalyticsSnapshot> = {},
): AnalyticsSnapshot => ({
  organization: { id: 'org', segment: 'HVAC_R' },
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
const metric = (data: AnalyticsSnapshot, id: string) =>
  engine.execute(data).indicators.find((item) => item.id === id)!;
const health = (data: AnalyticsSnapshot) =>
  new HealthEngine().execute(engine.execute(data));

describe('Analytics facts and operational health', () => {
  it('does not assign health or invented performance to an empty organization', () => {
    const data = snapshot();
    expect(
      engine.execute(data).indicators.every((item) => item.value === 0),
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
        .execute(data)
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
    const kpis = engine.execute(data);
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
        .execute(snapshot())
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
    const trends = new TrendEngine().execute(data);
    expect(trends.series[0].points).toHaveLength(7);
    expect(
      trends.series[0].points.reduce((sum, item) => sum + item.value, 0),
    ).toBe(0);
    expect(
      trends.series[1].points.reduce((sum, item) => sum + item.value, 0),
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
    expect(new TrendEngine().execute(data).series[0].points[0]?.value).toBe(0);
  });
  it('does not publish a zero health score or simulated weather risks when there is no basis', async () => {
    const service = new AnalyticsService(
      {
        snapshot: jest.fn().mockResolvedValue(snapshot()),
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
