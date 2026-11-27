import { Prisma } from '@prisma/client';
import type {
  DiagnosticOperationsQuery,
  operationTypes,
  operationStates,
} from './corporate-support.dto';

type Source = (typeof operationTypes)[number];
export type DiagnosticOperation = {
  id: string;
  type: Source;
  status: (typeof operationStates)[number];
  stage: string;
  organizationId: string | null;
  mode: 'TEST' | 'LIVE' | null;
  attempts: number;
  version: number | null;
  lastExecutionAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date;
  correlationId: string | null;
  errorCode: string | null;
  recovery: 'RESUME_PROVISIONING' | null;
};

const safeErrors = [
  'CANONICAL_PROVISIONING_PENDING',
  'OWNER_SETUP_PENDING',
  'RETRY_EXHAUSTED',
  'NO_SESSION',
  'NO_INVOICE',
  'NO_FINANCIAL_ADJUSTMENT',
  'NO_SUBSCRIPTION',
  'AWAITING_PAYMENT',
  'PROVIDER_UNAVAILABLE',
  'BILLING_PROVIDER_UNAVAILABLE',
  'BILLING_MODE_MISMATCH',
  'BILLING_CUSTOMER_MISMATCH',
  'BILLING_LEASE_LOST',
  'BILLING_RECOVERY_LEASE_LOST',
  'BILLING_HISTORY_WINDOW_EXPIRED',
  'BILLING_INVALID_PROVIDER_PAGE',
  'CHECKOUT_CUSTOMER_MISMATCH',
  'CHECKOUT_MODE_MISMATCH',
  'AWS_CREDENTIALS_REJECTED',
  'SES_MESSAGE_REJECTED',
  'SES_IDENTITY_NOT_VERIFIED',
  'SES_ACCOUNT_SUSPENDED',
  'SES_SENDING_PAUSED',
  'SES_THROTTLED',
  'SES_LIMIT_EXCEEDED',
  'SES_INVALID_REQUEST',
  'SES_RESOURCE_NOT_FOUND',
  'SES_ACCESS_DENIED',
  'AWS_CREDENTIALS_EXPIRED',
  'SES_SERVICE_ERROR',
  'SES_MESSAGE_ID_MISSING',
  'EMAIL_STATE_UNAVAILABLE',
  'EMAIL_TRANSPORT_ERROR',
  'EMAIL_NOT_CONFIGURED',
  'EMAIL_SUPPRESSED',
  'CONTACT_WORKER_ERROR',
  'EMAIL_WORKER_ERROR',
  'INVALID_MESSAGE',
] as const;

const correlation = (field: Prisma.Sql) =>
  Prisma.sql`CASE WHEN ${field} ~* '^([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$' THEN ${field} END`;
const allowed = (field: Prisma.Sql, values: string[]) =>
  Prisma.sql`CASE WHEN ${field} IN (${Prisma.join(values)}) THEN ${field} ELSE 'UNKNOWN' END`;
const queueStatus = Prisma.sql`CASE
  WHEN status IN ('ACCEPTED_BY_PROVIDER', 'ACCEPTED') THEN 'SUCCEEDED'
  WHEN status = 'SKIPPED' THEN 'IGNORED'
  WHEN last_error_code = 'SES_MESSAGE_ID_MISSING' THEN 'UNCONFIRMED'
  WHEN status = 'FAILED' THEN 'TERMINAL_FAILURE' WHEN status = 'RUNNING' THEN 'PROCESSING'
  WHEN status = 'PENDING' AND last_error_code IS NOT NULL THEN 'RETRYABLE_FAILURE'
  WHEN status = 'PENDING' THEN 'PENDING' ELSE 'UNCONFIRMED' END`;

export function diagnosticRows(
  query: Partial<DiagnosticOperationsQuery>,
  id?: string,
  integrations = false,
) {
  const physicalId = id && !id.startsWith('STRIPE:') ? id : undefined;
  const conditions = (
    field: Prisma.Sql,
    orgField?: Prisma.Sql,
  ) => Prisma.sql`WHERE TRUE
    ${physicalId ? Prisma.sql`AND ${field} = ${physicalId}::uuid` : Prisma.empty}
    ${query.organizationId ? (orgField ? Prisma.sql`AND ${orgField} = ${query.organizationId}::uuid` : Prisma.sql`AND FALSE`) : Prisma.empty}`;
  const mode = (field: Prisma.Sql) =>
    Prisma.sql`CASE WHEN ${field} IN ('TEST','LIVE') THEN ${field} END`;
  const selected: Prisma.Sql[] = [];
  const include = (type: Source) =>
    (!query.type || query.type === type) &&
    (!integrations || type !== 'TENANT_PROVISIONING') &&
    (!id ||
      (id.startsWith('STRIPE:')
        ? type === 'STRIPE_RECOVERY'
        : type !== 'STRIPE_RECOVERY')) &&
    (!query.mode || type === 'STRIPE_RECOVERY' || type === 'STRIPE_WEBHOOK');
  if (include('TENANT_PROVISIONING'))
    selected.push(Prisma.sql`
    SELECT id::text AS id, 'TENANT_PROVISIONING'::text AS type, organization_id, NULL::text AS mode,
      CASE WHEN status = 'COMPLETED' THEN 'SUCCEEDED'
        WHEN last_error_code IS NOT NULL AND status IN ('TENANT_CREATED','SUBSCRIPTION_READY') THEN 'RETRYABLE_FAILURE'
        WHEN status IN ('RECEIVED','TENANT_CREATED','SUBSCRIPTION_READY') THEN 'PENDING' ELSE 'UNCONFIRMED' END AS status,
      ${allowed(Prisma.sql`status`, ['RECEIVED', 'TENANT_CREATED', 'SUBSCRIPTION_READY', 'COMPLETED'])} AS stage,
      attempts, version, CASE WHEN attempts > 0 THEN updated_at ELSE completed_at END AS last_execution_at,
      completed_at, updated_at, ${correlation(Prisma.sql`correlation_id`)} AS correlation_id, last_error_code,
      CASE WHEN technical_principal_id = public.app_corporate_support_principal()
        AND status IN ('TENANT_CREATED','SUBSCRIPTION_READY') THEN 'RESUME_PROVISIONING' END AS recovery
    FROM public.platform_tenant_provisionings ${conditions(Prisma.sql`id`, Prisma.sql`organization_id`)}
  `);
  if (include('STRIPE_WEBHOOK'))
    selected.push(Prisma.sql`
    SELECT id::text, 'STRIPE_WEBHOOK', NULL::uuid, ${mode(Prisma.sql`mode`)},
      CASE WHEN processing_status = 'DEAD_LETTER' THEN 'TERMINAL_FAILURE'
        WHEN processing_status = 'PROCESSED' THEN 'SUCCEEDED' WHEN processing_status = 'IGNORED' THEN 'IGNORED'
        WHEN processing_status = 'PROCESSING' THEN 'PROCESSING'
        WHEN processing_status = 'PENDING' AND last_error_code IS NOT NULL THEN 'RETRYABLE_FAILURE'
        WHEN processing_status = 'PENDING' THEN 'PENDING' ELSE 'UNCONFIRMED' END,
      ${allowed(Prisma.sql`processing_status`, ['PENDING', 'PROCESSING', 'PROCESSED', 'IGNORED', 'DEAD_LETTER'])},
      attempts, NULL::integer, coalesce(processed_at, dead_lettered_at, processing_started_at, CASE WHEN attempts > 0 THEN updated_at END),
      processed_at, updated_at, NULL::text, last_error_code, NULL::text
    FROM public.billing_webhook_events ${conditions(Prisma.sql`id`)}
    ${query.mode ? Prisma.sql`AND mode = ${query.mode}` : Prisma.empty}
  `);
  if (include('STRIPE_RECOVERY'))
    selected.push(Prisma.sql`
    SELECT key::text, 'STRIPE_RECOVERY', NULL::uuid, ${mode(Prisma.sql`mode`)},
      CASE WHEN status = 'DEAD_LETTER' THEN 'TERMINAL_FAILURE' WHEN status = 'RUNNING' THEN 'PROCESSING'
        WHEN status = 'READY' AND last_error_code IS NOT NULL THEN 'RETRYABLE_FAILURE'
        WHEN status = 'READY' AND last_completed_at IS NOT NULL THEN 'SUCCEEDED'
        WHEN status = 'READY' THEN 'PENDING' ELSE 'UNCONFIRMED' END,
      ${allowed(Prisma.sql`status`, ['READY', 'RUNNING', 'DEAD_LETTER'])},
      attempts, NULL::integer, CASE WHEN attempts > 0 THEN updated_at ELSE last_completed_at END,
      last_completed_at, updated_at, NULL::text, last_error_code, NULL::text
    FROM public.billing_recovery_checkpoints WHERE mode IN ('TEST','LIVE') AND stream IN ('EVENTS','SUBSCRIPTIONS')
      AND key = 'STRIPE:' || mode || ':' || stream
      ${id ? Prisma.sql`AND key = ${id}` : Prisma.empty}
      ${query.mode ? Prisma.sql`AND mode = ${query.mode}` : Prisma.empty}
      ${query.organizationId ? Prisma.sql`AND FALSE` : Prisma.empty}
  `);
  if (include('IDENTITY_EMAIL'))
    selected.push(Prisma.sql`
    SELECT id::text, 'IDENTITY_EMAIL', organization_id, NULL::text, ${queueStatus},
      ${allowed(Prisma.sql`status`, ['PENDING', 'RUNNING', 'FAILED', 'ACCEPTED_BY_PROVIDER', 'SKIPPED'])},
      attempts, NULL::integer, coalesce(finished_at, locked_at, CASE WHEN attempts > 0 THEN updated_at END),
      finished_at, updated_at, ${correlation(Prisma.sql`correlation_id`)}, last_error_code, NULL::text
    FROM public.identity_email_deliveries ${conditions(Prisma.sql`id`, Prisma.sql`organization_id`)}
  `);
  if (include('CONTACT_EMAIL'))
    selected.push(Prisma.sql`
    SELECT id::text, 'CONTACT_EMAIL', NULL::uuid, NULL::text, ${queueStatus},
      ${allowed(Prisma.sql`status`, ['PENDING', 'RUNNING', 'FAILED', 'ACCEPTED', 'SKIPPED'])},
      attempts, NULL::integer, coalesce(accepted_at, locked_at, CASE WHEN attempts > 0 THEN updated_at END), accepted_at, updated_at,
      ${correlation(Prisma.sql`correlation_id`)}, last_error_code, NULL::text
    FROM public.public_contact_submissions ${conditions(Prisma.sql`id`)}
  `);
  if (!selected.length) return null;
  return Prisma.sql`
    WITH operations(id, type, organization_id, mode, status, stage, attempts, version, last_execution_at, completed_at,
      updated_at, correlation_id, last_error_code, recovery) AS (${Prisma.join(selected, ' UNION ALL ')}),
    filtered AS (
      SELECT id, type, organization_id AS "organizationId", mode, status, stage, attempts, version,
        last_execution_at AS "lastExecutionAt", completed_at AS "completedAt", updated_at AS "updatedAt",
        correlation_id AS "correlationId", recovery,
        CASE WHEN last_error_code IN (${Prisma.join([...safeErrors])}) THEN last_error_code
          WHEN last_error_code IS NOT NULL THEN 'UNCLASSIFIED_FAILURE' END AS "errorCode"
      FROM operations
      ${query.status ? Prisma.sql`WHERE status = ${query.status}` : Prisma.empty}
    )`;
}

export function safeProvisioningError(code: string | null) {
  if (code === null) return null;
  return safeErrors.some((value) => value === code)
    ? code
    : 'UNCLASSIFIED_FAILURE';
}
