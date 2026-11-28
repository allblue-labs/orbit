import { Prisma } from '@prisma/client';
import {
  invoiceDate,
  invoiceScope,
  issued,
  openBalance,
  overdue,
  paymentRecords,
  type FinancePeriod,
} from './corporate-finance.queries';

export const recurringMinorDenominator = 120_000;
export const trialObservationDays = 30;

export function recurringRevenue(
  mode: 'TEST' | 'LIVE',
  currency: string,
  asOf: Date,
  planCode?: string,
) {
  return Prisma.sql`
    WITH candidates AS (
      SELECT s.plan_code, s.billing_interval,
        CASE WHEN r.mode = ${mode} AND r."providerPriceId" = s.provider_price_id
          AND r."periodStart" = s.current_period_start AND r."periodEnd" = s.current_period_end
          AND r."observedAt" BETWEEN s.current_period_start AND ${asOf}
          AND r."intervalMonths" = CASE s.billing_interval WHEN 'MONTHLY' THEN 1 WHEN 'SEMIANNUAL' THEN 6 WHEN 'ANNUAL' THEN 12 END
          AND r."grossPeriodMinor" > 0 THEN r.currency END AS currency,
        r."observedAt", r.paid, r."intervalMonths" AS months,
        r."grossPeriodMinor"::numeric * 10000 AS gross,
        CASE WHEN r.discount->>'endsAt' IS NOT NULL AND (r.discount->>'endsAt')::timestamptz <= ${asOf}
          THEN 0 ELSE (r.discount->>'scaledMinor')::numeric END AS discount
      FROM public.organization_subscriptions s
      JOIN public.billing_customers c ON c.organization_id = s.organization_id
        AND c.provider = s.provider AND c.provider_customer_id = s.provider_customer_id AND c.mode = ${mode}
      LEFT JOIN LATERAL jsonb_to_record(s.recurring_observation) AS r(
        mode text, currency text, "providerPriceId" text, "periodStart" timestamptz, "periodEnd" timestamptz,
        "observedAt" timestamptz, "intervalMonths" int, "grossPeriodMinor" int, paid boolean, discount jsonb
      ) ON true
      WHERE s.provider = 'STRIPE' AND s.provider_subscription_id IS NOT NULL
        AND s.ended_at IS NULL AND s.status = 'ACTIVE'
        AND s.current_period_start <= ${asOf} AND s.current_period_end > ${asOf}
        ${planCode ? Prisma.sql`AND s.plan_code = ${planCode}` : Prisma.empty}
    ), matching AS (
      SELECT *, currency = ${currency.toLowerCase()} AND paid IS TRUE AS eligible,
        discount BETWEEN 0 AND gross AS valid_discount
      FROM candidates WHERE currency IS NULL OR currency = ${currency.toLowerCase()}
    )
    SELECT plan_code AS "planCode", billing_interval AS "billingInterval",
      count(*)::int AS "candidateOrganizations",
      count(*) FILTER (WHERE currency IS NULL)::int AS "unknownTermsOrganizations",
      count(*) FILTER (WHERE currency IS NOT NULL AND paid IS NOT TRUE)::int AS "unverifiedPaymentOrganizations",
      count(*) FILTER (WHERE eligible)::int AS "confirmedEligibleOrganizations",
      count(*) FILTER (WHERE eligible AND valid_discount IS NOT TRUE)::int AS "unpricedOrganizations",
      count(*) FILTER (WHERE eligible AND valid_discount)::int AS "pricedOrganizations",
      min("observedAt") FILTER (WHERE eligible AND valid_discount) AS "oldestObservationAt",
      max("observedAt") FILTER (WHERE eligible AND valid_discount) AS "latestObservationAt",
      sum(gross * (12 / months)) FILTER (WHERE eligible AND valid_discount)::text AS "grossMonthlyScaledMinor",
      sum(discount * (12 / months)) FILTER (WHERE eligible AND valid_discount)::text AS "discountMonthlyScaledMinor",
      sum((gross - discount) * (12 / months)) FILTER (WHERE eligible AND valid_discount)::text AS "monthlyRecurringScaledMinor"
    FROM matching
    GROUP BY GROUPING SETS ((), (plan_code, billing_interval))
    ORDER BY GROUPING(plan_code) DESC, "planCode", "billingInterval"
  `;
}

export function delinquency(period: FinancePeriod, asOf: Date) {
  return Prisma.sql`
    WITH population AS (
      SELECT i.organization_id, i.plan_code_at_issue, ${overdue(asOf)} AS overdue,
        (${openBalance} AND i.due_at IS NULL) AS undated
      FROM public.billing_invoices i
      WHERE ${invoiceScope(period.mode, { ...period, planCode: undefined })} AND ${issued}
        AND (i.amount_due_minor > 0 OR i.amount_remaining_minor > 0 OR i.amount_paid_minor > 0)
        AND ${invoiceDate} >= ${period.start} AND ${invoiceDate} < ${period.end}
        AND ${invoiceDate} <= ${asOf}
    ), eligible AS (
      SELECT organization_id, bool_or(overdue) AS overdue, bool_or(undated) AS undated
      FROM population
      ${period.planCode ? Prisma.sql`WHERE plan_code_at_issue = ${period.planCode}` : Prisma.empty}
      GROUP BY organization_id
    )
    SELECT count(*)::int AS "eligibleOrganizations", count(*) FILTER (WHERE overdue)::int AS "overdueOrganizations",
      count(*) FILTER (WHERE undated)::int AS "undatedOpenOrganizations",
      (SELECT count(*)::int FROM population WHERE plan_code_at_issue IS NULL) AS "unattributedInvoices",
      round(100.0 * count(*) FILTER (WHERE overdue) / nullif(count(*), 0), 2)::text AS "observedRatePercent"
    FROM eligible
  `;
}

export function customerLifecycle(period: FinancePeriod, asOf: Date) {
  return Prisma.sql`
    WITH ${paymentRecords(invoiceScope(period.mode, period), period, 'RECEIPT')},
    observed_contracts AS MATERIALIZED (
      SELECT "organizationId" AS organization_id, "subscriptionId" AS subscription_id, min("occurredAt") AS first_receipt
      FROM payment_facts
      WHERE "occurredAt" < ${period.end} AND "occurredAt" <= ${asOf}
      GROUP BY "organizationId", "subscriptionId"
    ), paid_population AS (
      SELECT organization_id, min(first_receipt) AS first_receipt
      FROM observed_contracts GROUP BY organization_id
    ), recorded_cancellations AS MATERIALIZED (
      SELECT s.organization_id, s.id, s.ended_at
      FROM public.organization_subscriptions s
      JOIN observed_contracts p ON p.organization_id = s.organization_id AND p.subscription_id = s.id
      WHERE s.provider = 'STRIPE' AND s.status = 'CANCELED'
        AND s.ended_at > p.first_receipt AND s.ended_at < ${period.end} AND s.ended_at <= ${asOf}
    )
    SELECT
      (SELECT count(*)::int FROM paid_population WHERE first_receipt >= ${period.start}) AS "firstObservedPaidOrganizations",
      (SELECT count(DISTINCT organization_id)::int FROM observed_contracts
        WHERE first_receipt >= ${period.start}) AS "organizationsWithFirstReceiptForAContract",
      (SELECT count(DISTINCT organization_id)::int FROM recorded_cancellations
        WHERE ended_at >= ${period.start}) AS "recordedPaidCancellations",
      (SELECT count(DISTINCT p.organization_id)::int FROM observed_contracts p
        WHERE p.first_receipt >= ${period.start}
          AND EXISTS (SELECT 1 FROM recorded_cancellations c WHERE c.organization_id = p.organization_id
            AND c.id <> p.subscription_id AND c.ended_at < p.first_receipt)) AS "observedReactivatedOrganizations"
  `;
}

export function trialConversion(period: FinancePeriod, asOf: Date) {
  const trialDays = Prisma.sql`interval '24 hours' * ${trialObservationDays}::int`;
  return Prisma.sql`
    WITH cohort AS MATERIALIZED (
      SELECT g.organization_id, g.starts_at, g.ends_at, g.ends_at + ${trialDays} AS observe_until
      FROM public.subscription_trial_grants g
      WHERE g.starts_at >= ${period.start} AND g.starts_at < ${period.end} AND g.starts_at <= ${asOf}
        ${period.planCode ? Prisma.sql`AND g.plan_code = ${period.planCode}` : Prisma.empty}
        AND NOT EXISTS (SELECT 1 FROM public.subscription_trial_grants earlier
          WHERE earlier.organization_id = g.organization_id AND (earlier.starts_at, earlier.id) < (g.starts_at, g.id))
    ), ${paymentRecords(
      Prisma.sql`${invoiceScope(period.mode, { ...period, planCode: undefined })}
        AND EXISTS (SELECT 1 FROM cohort g WHERE g.organization_id = i.organization_id
          AND ${invoiceDate} < g.observe_until)
      `,
      undefined,
      'RECEIPT',
    )},
    conversions AS (
      SELECT g.organization_id
      FROM cohort g JOIN payment_facts p ON p."organizationId" = g.organization_id
        AND p."occurredAt" < g.observe_until AND p."occurredAt" <= ${asOf}
      GROUP BY g.organization_id, g.starts_at
      HAVING min(p."occurredAt") >= g.starts_at
    )
    SELECT count(*)::int AS "startedOrganizations",
      count(*) FILTER (WHERE g.ends_at > ${asOf})::int AS "scheduledInProgressOrganizations",
      count(*) FILTER (WHERE g.ends_at <= ${asOf})::int AS "scheduledEndedOrganizations",
      count(c.organization_id)::int AS "confirmedConvertedOrganizations",
      count(*) FILTER (WHERE g.observe_until <= ${asOf})::int AS "eligibleOrganizations",
      count(c.organization_id) FILTER (WHERE g.observe_until <= ${asOf})::int AS "confirmedEligibleConversions"
    FROM cohort g LEFT JOIN conversions c USING (organization_id)
  `;
}
