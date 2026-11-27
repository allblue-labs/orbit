import { Prisma } from '@prisma/client';
import type { FinancePeriodDto } from './corporate-finance.dto';

export type FinancePeriod = FinancePeriodDto & { start: Date; end: Date };

export function invoiceScope(
  mode: string,
  query?: FinancePeriod,
  invoiceId?: string,
) {
  return Prisma.sql`
    i.provider = 'STRIPE' AND i.mode = ${mode}
    ${query ? Prisma.sql`AND i.currency = ${query.currency.toLowerCase()}` : Prisma.empty}
    ${query?.planCode ? Prisma.sql`AND i.plan_code_at_issue = ${query.planCode}` : Prisma.empty}
    ${invoiceId ? Prisma.sql`AND i.id = ${invoiceId}::uuid` : Prisma.empty}
  `;
}

export const invoiceDate = Prisma.sql`coalesce(i.finalized_at, i.provider_created_at)`;
export const paymentView = Prisma.sql`
  id, "invoiceId", "organizationId", "subscriptionId", "planCode", mode, currency,
  kind, status, "amountMinor"::int AS "amountMinor", "occurredAt", "observedAt"
`;
const openBalance = Prisma.sql`i.status = 'OPEN' AND i.amount_remaining_minor > 0`;
const writeOff = Prisma.sql`i.status = 'UNCOLLECTIBLE' AND i.amount_remaining_minor > 0`;
const issued = Prisma.sql`i.status IN ('OPEN','PAID','UNCOLLECTIBLE')`;

function overdue(asOf: Date) {
  return Prisma.sql`${openBalance} AND i.due_at < ${asOf}`;
}

export function invoiceView(asOf: Date) {
  return Prisma.sql`
    i.id, i.organization_id AS "organizationId", i.subscription_id AS "subscriptionId",
    i.plan_code_at_issue AS "planCode", i.invoice_number AS number, i.status, i.mode, upper(i.currency) AS currency,
    i.subtotal_minor AS "subtotalMinor", i.discount_minor AS "discountMinor", i.tax_minor AS "taxMinor",
    i.total_minor AS "totalMinor", i.amount_due_minor AS "amountDueMinor",
    i.amount_paid_minor AS "providerSettledMinor", i.amount_remaining_minor AS "amountRemainingMinor",
    i.credit_notes_minor AS "creditNotesMinor", i.attempt_count AS "attemptCount",
    i.period_start AS "periodStart", i.period_end AS "periodEnd", i.due_at AS "dueAt",
    i.next_payment_attempt_at AS "nextPaymentAttemptAt", i.paid_at AS "settledAt",
    i.voided_at AS "voidedAt", i.finalized_at AS "finalizedAt",
    i.marked_uncollectible_at AS "markedUncollectibleAt", i.provider_created_at AS "createdAt",
    i.provider_observed_at AS "observedAt", ${invoiceDate} AS "reportingAt",
    CASE WHEN ${writeOff} THEN 'UNCOLLECTIBLE'
         WHEN ${overdue(asOf)} THEN 'OVERDUE'
         WHEN ${openBalance} THEN 'PENDING'
         WHEN i.status = 'UNKNOWN' THEN 'INSUFFICIENT_EVIDENCE'
         ELSE 'NO_OPEN_BALANCE' END AS "balanceStatus",
    receipts."confirmedReceivedMinor"
  `;
}

export function paymentRecords(
  scope: Prisma.Sql,
  bounds?: FinancePeriod,
  kind?: string,
  recordId?: string,
) {
  const receipts = !kind || kind === 'RECEIPT';
  const attempts = !kind || kind === 'ATTEMPT';
  const adjustments = !kind || kind === 'REFUND' || kind === 'DISPUTE';

  const receiptRows = Prisma.sql`
    SELECT 'receipt_' || i.id || '_' || encode(sha256(convert_to(e.value->>'invoicePaymentId', 'UTF8')), 'hex') AS id,
      i.id AS "invoiceId", i.organization_id AS "organizationId", i.subscription_id AS "subscriptionId",
      i.plan_code_at_issue AS "planCode", i.mode, upper(i.currency) AS currency, 'RECEIPT'::text AS kind,
      'CONFIRMED'::text AS status, e.value->>'invoicePaymentId' AS "allocationId",
      CASE WHEN (e.value->>'amountMinor') ~ '^[1-9][0-9]{0,9}$'
        THEN (e.value->>'amountMinor')::bigint END AS "amountMinor",
      CASE WHEN (e.value->>'confirmedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*Z$'
        AND pg_input_is_valid(e.value->>'confirmedAt', 'timestamp with time zone')
        THEN (e.value->>'confirmedAt')::timestamptz END AS "occurredAt",
      i.provider_observed_at AS "observedAt"
    FROM scoped_invoices i
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(i.payment_evidence) = 'array' THEN i.payment_evidence ELSE '[]'::jsonb END
    ) e
    WHERE e.value->>'currency' = lower(i.currency)
      AND e.value->>'invoicePaymentId' <> '' AND e.value->>'paymentIntentId' <> ''
  `;
  const facts: Prisma.Sql[] = [];
  if (receipts) {
    facts.push(Prisma.sql`
      SELECT DISTINCT ON ("allocationId") id, "invoiceId", "organizationId", "subscriptionId",
        "planCode", mode, currency, kind, status, "amountMinor", "occurredAt", "observedAt"
      FROM receipt_rows
      WHERE "amountMinor" BETWEEN 1 AND 2147483647 AND "occurredAt" IS NOT NULL
      ORDER BY "allocationId", "observedAt" DESC, id, "occurredAt", "amountMinor"
    `);
  }
  if (attempts) {
    facts.push(Prisma.sql`
      SELECT 'attempt_' || t.id AS id, i.id, i.organization_id, i.subscription_id,
        i.plan_code_at_issue, i.mode, upper(i.currency), 'ATTEMPT', 'REJECTED',
        NULL::bigint, t.source_occurred_at, t.observed_at
      FROM scoped_invoices i
      JOIN public.billing_invoice_transitions t ON t.billing_invoice_id = i.id
        AND t.organization_id = i.organization_id AND t.provider = i.provider
      WHERE t.source_event_type = 'invoice.payment_failed' AND t.source_occurred_at IS NOT NULL
      ${bounds ? Prisma.sql`AND t.source_occurred_at >= ${bounds.start} AND t.source_occurred_at < ${bounds.end}` : Prisma.empty}
      ${recordId ? Prisma.sql`AND t.id = ${recordId}::uuid` : Prisma.empty}
    `);
  }
  if (adjustments) {
    facts.push(Prisma.sql`
      SELECT lower(a.type) || '_' || a.id AS id, i.id, i.organization_id, i.subscription_id,
        i.plan_code_at_issue, i.mode, upper(a.currency), a.type, a.status,
        a.amount_minor::bigint, a.occurred_at, a.provider_observed_at
      FROM scoped_invoices i
      JOIN public.billing_financial_adjustments a ON a.billing_invoice_id = i.id
        AND a.organization_id = i.organization_id AND a.provider = i.provider
      WHERE a.currency = i.currency AND a.type IN ('REFUND', 'DISPUTE')
      ${kind ? Prisma.sql`AND a.type = ${kind}` : Prisma.empty}
      ${bounds ? Prisma.sql`AND a.occurred_at >= ${bounds.start} AND a.occurred_at < ${bounds.end}` : Prisma.empty}
      ${recordId ? Prisma.sql`AND a.id = ${recordId}::uuid` : Prisma.empty}
    `);
  }
  return Prisma.sql`
    scoped_invoices AS NOT MATERIALIZED (
      SELECT i.id, i.organization_id, i.subscription_id, i.plan_code_at_issue,
        i.provider, i.mode, i.currency, i.payment_evidence, i.provider_observed_at
      FROM public.billing_invoices i
      WHERE ${scope}
      ${bounds ? Prisma.sql`AND i.provider_created_at < ${bounds.end}` : Prisma.empty}
    ),
    ${receipts ? Prisma.sql`receipt_rows AS (${receiptRows}),` : Prisma.empty}
    payment_facts(id, "invoiceId", "organizationId", "subscriptionId", "planCode", mode, currency,
      kind, status, "amountMinor", "occurredAt", "observedAt") AS (
      ${Prisma.join(
        facts.map((fact) => Prisma.sql`(${fact})`),
        ' UNION ALL ',
      )}
    )
  `;
}

export function periodSummary(period: FinancePeriod, asOf: Date) {
  const scope = invoiceScope(period.mode, period);
  return Prisma.sql`
    WITH ${paymentRecords(scope, period)},
    invoice_summary AS (
      SELECT date_trunc('month', ${invoiceDate} AT TIME ZONE 'UTC')::date AS month,
        count(*) FILTER (WHERE i.status = 'DRAFT')::int AS "draftCount",
        count(*) FILTER (WHERE i.status = 'OPEN')::int AS "openCount",
        count(*) FILTER (WHERE i.status = 'PAID')::int AS "paidCount",
        count(*) FILTER (WHERE i.status = 'VOID')::int AS "voidCount",
        count(*) FILTER (WHERE i.status = 'UNCOLLECTIBLE')::int AS "uncollectibleCount",
        count(*) FILTER (WHERE i.status = 'UNKNOWN')::int AS "unknownCount",
        count(*) FILTER (WHERE i.plan_code_at_issue IS NULL)::int AS "unattributedInvoiceCount",
        count(*) FILTER (WHERE (i.amount_paid_minor > 0 OR i.status = 'PAID')
          AND NOT EXISTS (SELECT 1 FROM payment_facts p WHERE p.kind = 'RECEIPT' AND p."invoiceId" = i.id)
        )::int AS "settledWithoutReceiptEvidenceCount",
        count(DISTINCT i.organization_id) FILTER (WHERE ${overdue(asOf)})::int AS "overdueOrganizationCount",
        max(i.provider_observed_at) AS "invoiceObservedAt",
        sum(i.subtotal_minor) FILTER (WHERE ${issued})::text AS "subtotalMinor",
        sum(i.total_minor) FILTER (WHERE ${issued})::text AS "billedMinor",
        sum(i.discount_minor) FILTER (WHERE ${issued})::text AS "discountMinor",
        sum(i.amount_remaining_minor) FILTER (WHERE ${openBalance})::text AS "openMinor",
        sum(i.amount_remaining_minor) FILTER (WHERE ${overdue(asOf)})::text AS "overdueMinor",
        sum(i.amount_remaining_minor) FILTER (WHERE ${openBalance} AND
          (i.due_at IS NULL OR i.due_at >= ${asOf}))::text AS "pendingMinor",
        sum(i.amount_remaining_minor) FILTER (WHERE ${writeOff})::text AS "uncollectibleMinor"
      FROM public.billing_invoices i
      WHERE ${scope} AND ${invoiceDate} >= ${period.start} AND ${invoiceDate} < ${period.end}
      GROUP BY GROUPING SETS ((), (date_trunc('month', ${invoiceDate} AT TIME ZONE 'UTC')::date))
    ),
    cash_summary AS (
      SELECT date_trunc('month', "occurredAt" AT TIME ZONE 'UTC')::date AS month,
        count(*) FILTER (WHERE kind = 'RECEIPT')::int AS "confirmedReceiptCount",
        sum("amountMinor") FILTER (WHERE kind = 'RECEIPT')::text AS "confirmedReceivedMinor",
        sum("amountMinor") FILTER (WHERE kind = 'REFUND' AND status = 'SUCCEEDED')::text AS "recordedRefundMinor",
        max("observedAt") AS "paymentObservedAt"
      FROM payment_facts
      WHERE "occurredAt" >= ${period.start} AND "occurredAt" < ${period.end}
      GROUP BY GROUPING SETS ((), (date_trunc('month', "occurredAt" AT TIME ZONE 'UTC')::date))
    )
    SELECT *
    FROM invoice_summary
    FULL JOIN cash_summary USING (month)
    WHERE invoice_summary.month IS NOT NULL OR cash_summary.month IS NOT NULL
    UNION ALL
    SELECT NULL::date, i."draftCount", i."openCount", i."paidCount", i."voidCount", i."uncollectibleCount",
      i."unknownCount", i."unattributedInvoiceCount", i."settledWithoutReceiptEvidenceCount",
      i."overdueOrganizationCount", i."invoiceObservedAt", i."subtotalMinor", i."billedMinor", i."discountMinor", i."openMinor",
      i."overdueMinor", i."pendingMinor", i."uncollectibleMinor", c."confirmedReceiptCount",
      c."confirmedReceivedMinor", c."recordedRefundMinor", c."paymentObservedAt"
    FROM invoice_summary i CROSS JOIN cash_summary c
    WHERE i.month IS NULL AND c.month IS NULL
    ORDER BY month NULLS FIRST
  `;
}

export function pagedRows(
  rows: Prisma.Sql,
  kind: 'invoice' | 'payment',
  page: number,
  pageSize: number,
  sort: string | undefined,
) {
  const fields = {
    invoice: {
      date: Prisma.sql`"reportingAt"`,
      amount: Prisma.sql`"totalMinor"`,
    },
    payment: {
      date: Prisma.sql`"occurredAt"`,
      amount: Prisma.sql`"amountMinor"`,
    },
  };
  const field = fields[kind][sort?.startsWith('AMOUNT') ? 'amount' : 'date'];
  const direction = sort?.endsWith('_ASC') ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const order = Prisma.sql`${field} ${direction} NULLS LAST, id ${direction}`;
  return Prisma.sql`
    WITH matches AS MATERIALIZED (${rows}),
    stats AS (SELECT count(*)::int AS total FROM matches)
    SELECT stats.total, listed.*
    FROM stats
    LEFT JOIN LATERAL (
      SELECT * FROM matches ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    ) listed ON true
    ORDER BY ${order}
  `;
}
