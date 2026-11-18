import { Prisma } from '@prisma/client';
import type { AnalyticsGranularity, AnalyticsRange } from './analytics.types';

const terminal = Prisma.sql`('COMPLETED', 'DONE', 'CLOSED', 'FINALIZED', 'PUBLISHED')`;
const cancelled = Prisma.sql`('CANCELLED', 'CANCELED')`;

const scope = (organizationId: string, unitId?: string) => Prisma.sql`
  organization_id = ${organizationId}::uuid
  ${unitId ? Prisma.sql`AND business_unit_id = ${unitId}::uuid` : Prisma.empty}
`;

function trendBucket(column: Prisma.Sql, granularity: AnalyticsGranularity) {
  const utc = Prisma.sql`(${column} AT TIME ZONE 'UTC')`;
  return granularity === 'WEEK'
    ? Prisma.sql`date_trunc('week', ${utc} + interval '1 day') - interval '1 day'`
    : Prisma.sql`date_trunc(${granularity.toLowerCase()}, ${utc})`;
}

function trendRows(
  table: Prisma.Sql,
  column: Prisma.Sql,
  range: AnalyticsRange,
) {
  return Prisma.sql`(
    SELECT COALESCE(jsonb_agg(jsonb_build_object('timestamp', to_char(bucket, 'YYYY-MM-DD"T"HH24:MI:SS') || '.000Z', 'value', value)), '[]')
    FROM (
      SELECT ${trendBucket(column, range.granularity)} AS bucket, count(*) AS value
      FROM ${table}
      WHERE ${column} BETWEEN ${range.from} AND ${range.to}
      GROUP BY 1
    ) AS grouped
  )`;
}

export function operationAnalytics(
  organizationId: string,
  range: AnalyticsRange,
  includeTrends: boolean,
  includeTechnicians: boolean,
) {
  const { from, to, previousFrom, previousTo, businessUnitId } = range;
  const where = Prisma.sql`
    ${scope(organizationId, businessUnitId)} AND deleted_at IS NULL AND status NOT IN ${cancelled}
  `;
  const counts = (where: Prisma.Sql) => Prisma.sql`
    jsonb_build_object(
      'cohort', count(*) FILTER (WHERE ${where}),
      'scheduled', count(scheduled_start) FILTER (WHERE ${where}),
      'assigned', count(responsible_field_technician_id) FILTER (WHERE ${where})
    )
  `;
  const delivered = (start: Date, end: Date) => {
    const window = Prisma.sql`completed_at BETWEEN ${start} AND ${end}
      AND created_at <= ${end} AND status IN ${terminal}`;
    return Prisma.sql`jsonb_build_object(
      'delivered', count(*) FILTER (WHERE ${window}),
      'withDeadline', count(scheduled_end) FILTER (WHERE ${window}),
      'onTime', count(*) FILTER (WHERE ${window} AND completed_at <= scheduled_end)
    )`;
  };

  // The three inputs have different date predicates. Keep them independent so
  // the created/completed indexes and the partial open index can each be used.
  return Prisma.sql`
    WITH created AS (
      SELECT created_at, completed_at, scheduled_start, responsible_field_technician_id, status
      FROM operations
      WHERE ${where} AND (
        created_at BETWEEN ${previousFrom} AND ${previousTo} OR created_at BETWEEN ${from} AND ${to}
      )
    ), deliveries AS (
      SELECT created_at, completed_at, scheduled_end, status
      FROM operations
      WHERE ${where} AND created_at <= ${to} AND (
        completed_at BETWEEN ${previousFrom} AND ${previousTo} OR completed_at BETWEEN ${from} AND ${to}
      )
    ), cohorts AS (
      SELECT
        ${counts(Prisma.sql`created_at >= ${from}`)} AS current_counts,
        ${counts(Prisma.sql`created_at <= ${previousTo}`)} AS previous_counts,
        count(*) FILTER (WHERE created_at >= ${from} AND status IN ${terminal} AND completed_at <= ${to})::int AS completed_cohort,
        ${
          includeTechnicians
            ? Prisma.sql`count(DISTINCT responsible_field_technician_id) FILTER (WHERE created_at >= ${from})::int`
            : Prisma.sql`0`
        } AS active_technicians
      FROM created
    ), fulfillment AS (
      SELECT ${delivered(from, to)} AS current_counts,
             ${delivered(previousFrom, previousTo)} AS previous_counts
      FROM deliveries
    ), backlog AS (
      SELECT count(*)::int AS open,
             count(*) FILTER (WHERE scheduled_end < ${to})::int AS overdue,
             count(scheduled_end)::int AS "openWithDeadline",
             count(*) FILTER (WHERE responsible_field_technician_id IS NULL)::int AS unassigned,
             count(*) FILTER (WHERE scheduled_start IS NULL)::int AS unscheduled
      FROM operations
      WHERE ${where} AND status NOT IN ${terminal} AND created_at <= ${to}
    )
    SELECT backlog.*,
           cohorts.current_counts || fulfillment.current_counts AS "current",
           cohorts.previous_counts || fulfillment.previous_counts AS "previous",
           completed_cohort AS "completedCohort", active_technicians AS "activeTechnicians",
           ${includeTrends ? trendRows(Prisma.sql`created`, Prisma.sql`created_at`, range) : Prisma.sql`'[]'::jsonb`} AS "createdTrend",
           ${includeTrends ? trendRows(Prisma.sql`deliveries`, Prisma.sql`completed_at`, range) : Prisma.sql`'[]'::jsonb`} AS "completedTrend"
    FROM backlog CROSS JOIN cohorts CROSS JOIN fulfillment
  `;
}

export function commitmentAnalytics(
  domain: 'PMOC' | 'RVT',
  organizationId: string,
  range: AnalyticsRange,
  includeTrends: boolean,
) {
  const { from, to, previousFrom, previousTo, businessUnitId } = range;
  // The old candidate read padded civil dates by one UTC day before resolving
  // their exact instants with the contract's timezone.
  const fromDay = new Date(previousFrom.getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
  const toDay = new Date(to.getTime() + 86_400_000).toISOString().slice(0, 10);
  const unit = (alias: Prisma.Sql) =>
    businessUnitId
      ? Prisma.sql`AND ${alias}.business_unit_id = ${businessUnitId}::uuid`
      : Prisma.empty;
  const candidates =
    domain === 'PMOC'
      ? Prisma.sql`
    SELECT e.status, e.performed_at AS finalized, e.due_on AS civil_day, u.timezone
    FROM pmoc_executions e
    JOIN pmoc_plans p ON p.id = e.plan_id AND p.organization_id = e.organization_id
    JOIN business_units u ON u.id = p.business_unit_id AND u.organization_id = p.organization_id
    WHERE e.organization_id = ${organizationId}::uuid AND p.deleted_at IS NULL
      ${unit(Prisma.sql`p`)}
      AND e.due_on <= ${toDay}::date
      AND (e.due_on >= ${fromDay}::date OR e.status NOT IN ('COMPLETED', 'CANCELLED') OR e.performed_at >= ${previousFrom})
  `
      : Prisma.sql`
    SELECT o.status, e.completed_at AS finalized,
      COALESCE((o.scheduled_for AT TIME ZONE c.timezone)::date, o.local_scheduled_date) AS civil_day, c.timezone
    FROM rvt_occurrences o
    JOIN rvt_configurations c ON c.id = o.configuration_id AND c.organization_id = o.organization_id
    LEFT JOIN rvt_executions e ON e.occurrence_id = o.id AND e.organization_id = o.organization_id
    WHERE o.organization_id = ${organizationId}::uuid AND o.deleted_at IS NULL AND c.deleted_at IS NULL
      ${unit(Prisma.sql`o`)}
      AND (o.scheduled_for <= ${to} OR (o.scheduled_for IS NULL AND o.local_scheduled_date <= ${toDay}::date))
      AND (o.scheduled_for >= ${previousFrom}
        OR (o.scheduled_for IS NULL AND o.local_scheduled_date >= ${fromDay}::date)
        OR o.status NOT IN ('COMPLETED', 'CANCELLED') OR e.completed_at >= ${previousFrom})
  `;
  const summary = (start: Date, end: Date) => {
    const due = Prisma.sql`status NOT IN ${cancelled} AND deadline <= ${end}`;
    const done = Prisma.sql`status IN ${terminal} AND finalized IS NOT NULL AND finalized <= ${end}`;
    const evaluated = Prisma.sql`${due} AND (deadline >= ${start} OR NOT (${done}))`;
    return Prisma.sql`jsonb_build_object(
      'total', count(*) FILTER (WHERE ${evaluated}),
      'overdue', count(*) FILTER (WHERE ${due} AND NOT (${done})),
      'onTime', count(*) FILTER (WHERE ${evaluated} AND (${done}) AND finalized <= deadline)
    )`;
  };
  return Prisma.sql`
    WITH candidates AS (${candidates}), civil AS (
      SELECT status, finalized, timezone,
        orbit_analytics_civil_instant(civil_day::timestamp, timezone) AS planned_at
      FROM candidates
    ), deadlines AS (
      SELECT status, finalized, planned_at,
        orbit_analytics_civil_instant((planned_at AT TIME ZONE timezone) + interval '1 day', timezone) - interval '1 millisecond' AS deadline
      FROM civil
    )
    SELECT ${summary(from, to)} AS "current", ${summary(previousFrom, previousTo)} AS "previous",
           ${includeTrends && domain === 'PMOC' ? trendRows(Prisma.sql`deadlines`, Prisma.sql`planned_at`, range) : Prisma.sql`'[]'::jsonb`} AS trend
    FROM deadlines
  `;
}
