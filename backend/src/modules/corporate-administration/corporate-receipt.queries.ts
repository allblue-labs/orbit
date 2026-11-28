import { Prisma } from '@prisma/client';
import { OPERATIONAL_DECISION } from '../tenant-operations/tenant-operation.policy';
import type { ReceiptType } from './corporate-completion.dto';

export const provisioningSelect = Prisma.sql`
  p.id, p.organization_id AS "organizationId", p.status, p.version, p.attempts,
  CASE WHEN p.status = 'RECEIVED' THEN 'RESUBMIT_ORIGINAL_REQUEST'
       WHEN p.status IN ('TENANT_CREATED','SUBSCRIPTION_READY') THEN 'RESUME' END AS "nextAction",
  p.last_error_code AS "lastErrorCode", p.plan_code AS "requestedPlanCode",
  p.billing_interval AS "requestedBillingInterval", p.created_at AS "createdAt",
  p.updated_at AS "updatedAt", p.completed_at AS "completedAt"`;

export function receiptQuery(
  type: ReceiptType,
  principal: string,
  filters: {
    organizationId?: string;
    id?: string;
    keyHash?: string;
    operation?: string;
  },
) {
  const byId = (id: Prisma.Sql) =>
    filters.id ? Prisma.sql`AND ${id} = ${filters.id}::uuid` : Prisma.empty;
  const byOrganization = (id: Prisma.Sql) =>
    filters.organizationId
      ? Prisma.sql`AND ${id} = ${filters.organizationId}::uuid`
      : Prisma.empty;
  const byKey = (hash: Prisma.Sql) =>
    filters.keyHash
      ? Prisma.sql`AND ${hash} = ${filters.keyHash}`
      : Prisma.empty;
  const byOperation = (operation: Prisma.Sql) =>
    filters.operation
      ? Prisma.sql`AND ${operation} = ${filters.operation}`
      : Prisma.empty;

  switch (type) {
    case 'PROVISIONING':
      return Prisma.sql`
        SELECT p.id, p.organization_id AS "organizationId", 'PROVISIONING'::text AS type,
          'PROVISION'::text AS operation, p.created_at AS "createdAt", ''::text AS tie,
          to_jsonb(p_view) AS outcome
        FROM public.platform_tenant_provisionings p
        CROSS JOIN LATERAL (SELECT ${provisioningSelect}) p_view
        WHERE p.technical_principal_id = ${principal}::uuid
          ${byId(Prisma.sql`p.id`)} ${byOrganization(Prisma.sql`p.organization_id`)}
          ${byKey(Prisma.sql`p.idempotency_key`)}`;
    case 'COMMERCIAL':
      return Prisma.sql`
        SELECT c.id, c.organization_id, 'COMMERCIAL', c.operation, c.created_at, '',
          jsonb_build_object('result', c.result->'result', 'ticketId', c.result->'ticketId',
            'subscriptionId', c.result->'subscriptionId', 'subscriptionVersion', c.result->'subscriptionVersion',
            'trialEndsAt', c.result->'trialEndsAt')
        FROM public.corporate_commercial_commands c
        WHERE c.technical_principal_id = ${principal}::uuid
          ${byId(Prisma.sql`c.id`)} ${byOrganization(Prisma.sql`c.organization_id`)}
          ${byKey(Prisma.sql`c.key_hash`)} ${byOperation(Prisma.sql`c.operation`)}`;
    case 'OPERATIONAL':
      return Prisma.sql`
        SELECT a.id, a.organization_id, 'OPERATIONAL', 'OPERATIONAL_STATUS', a.created_at, '',
          jsonb_build_object('result', a.after->'result', 'previousStatus', a.after->'previousStatus',
            'status', a.after->'status', 'reason', a.after->'reason', 'decidedAt', a.after->'decidedAt')
        FROM public.audit_logs a
        WHERE a.action = ${OPERATIONAL_DECISION} AND a.user_id IS NULL
          AND a.metadata->>'technicalPrincipalId' = ${principal}
          ${byId(Prisma.sql`a.id`)} ${byOrganization(Prisma.sql`a.organization_id`)}
          ${byKey(Prisma.sql`(a.metadata->>'idempotencyKeyHash')`)}`;
    case 'PROMOTION':
      return Prisma.sql`
        SELECT c.id, NULL::uuid, 'PROMOTION', c.operation, c.created_at, '',
          jsonb_build_object('promotionId', c.promotion_id, 'pending', c.result IS NULL,
            'status', c.result->'promotion'->'status', 'version', c.result->'promotion'->'version',
            'mode', c.result->'promotion'->'providerMode')
        FROM public.corporate_promotion_commands c
        WHERE c.technical_principal_id = ${principal}::uuid
          ${byId(Prisma.sql`c.id`)} ${byKey(Prisma.sql`c.key_hash`)} ${byOperation(Prisma.sql`c.operation`)}`;
    case 'SUPPORT':
      return Prisma.sql`
        SELECT i.id, coalesce(i.organization_id, p.organization_id), 'SUPPORT',
          coalesce(i.kind, 'PROVISIONING_RECOVERY'), r.created_at, r.key_hash::text,
          jsonb_strip_nulls(jsonb_build_object(
            'targetId', r.receipt->'id', 'status', r.receipt->'status', 'version', r.receipt->'version',
            'attempts', r.receipt->'attempts', 'complete', r.receipt->'complete',
            'lastErrorCode', r.receipt->'lastErrorCode'))
        FROM public.corporate_support_requests r
        LEFT JOIN public.corporate_support_interactions i ON i.id = CASE
          WHEN pg_input_is_valid(r.receipt->>'interactionId', 'uuid') THEN (r.receipt->>'interactionId')::uuid END
          AND r.receipt->>'id' = coalesce(i.administrative_ticket_id, i.billing_ticket_id)::text
        LEFT JOIN public.platform_tenant_provisionings p ON r.receipt ? 'complete'
          AND p.technical_principal_id = ${principal}::uuid
          AND p.id = CASE WHEN pg_input_is_valid(r.receipt->>'id', 'uuid') THEN (r.receipt->>'id')::uuid END
        WHERE r.technical_principal_id = ${principal}::uuid
          AND (i.id IS NOT NULL OR (r.receipt ? 'complete' AND ${!!filters.keyHash}::boolean) OR p.id IS NOT NULL)
          ${byId(Prisma.sql`i.id`)} ${byOrganization(Prisma.sql`coalesce(i.organization_id, p.organization_id)`)}
          ${byKey(Prisma.sql`r.key_hash`)}`;
  }
}
