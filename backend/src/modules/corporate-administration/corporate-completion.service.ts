import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import {
  projectPlatformSubscription,
  type PlatformSubscriptionSnapshot,
} from '../platform-administration/platform-subscription.projection';
import type { CorporateCall } from './corporate-access.guard';
import {
  receiptTypes,
  type ReceiptType,
  type ProvisioningListDto,
  type ReceiptHistoryDto,
  type ReceiptLookupDto,
  type SubscriptionListDto,
} from './corporate-completion.dto';
import { safeProvisioningError } from './corporate-diagnostics.queries';
import { provisioningSelect, receiptQuery } from './corporate-receipt.queries';
import { authorizedCorporateReference } from './corporate-request';
import {
  ORGANIZATIONS_PROVISIONING_READ,
  RECEIPTS_READ,
  SUBSCRIPTIONS_READ,
} from './technical-credential.service';

const grants = {
  PROVISIONINGS: ORGANIZATIONS_PROVISIONING_READ,
  RECEIPTS: RECEIPTS_READ,
  SUBSCRIPTIONS: SUBSCRIPTIONS_READ,
} as const;
type Scope = keyof typeof grants;
type Provisioning = {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  lastErrorCode: string | null;
};
type Receipt = {
  id: string | null;
  organizationId: string | null;
  type: ReceiptType;
  operation: string;
  createdAt: Date;
  outcome: { lastErrorCode?: string | null };
};
type Subscription = PlatformSubscriptionSnapshot & {
  organizationId: string;
  organizationName: string;
};

function parseDate(value?: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw new BadRequestException('Data do provisionamento inválida.');
  return parsed;
}

function sanitizeReceipt(receipt: Receipt) {
  if ('lastErrorCode' in receipt.outcome)
    receipt.outcome.lastErrorCode = safeProvisioningError(
      receipt.outcome.lastErrorCode ?? null,
    );
  return receipt;
}

@Injectable()
export class CorporateCompletionService {
  constructor(private readonly rls: RlsTransaction) {}

  provisionings(
    call: CorporateCall,
    reference: unknown,
    query: ProvisioningListDto,
  ) {
    const from = parseDate(query.createdFrom);
    const before = parseDate(query.createdBefore);
    if (from && before && from >= before)
      throw new BadRequestException('Período do provisionamento inválido.');
    return this.read(
      call,
      reference,
      'PROVISIONINGS',
      'LIST',
      query.organizationId,
      async (tx, principal) => {
        const [result] = await tx.$queryRaw<
          [{ items: Provisioning[]; total: number }]
        >`
        WITH matching AS MATERIALIZED (
          SELECT ${provisioningSelect} FROM public.platform_tenant_provisionings p
          WHERE p.technical_principal_id = ${principal}::uuid
            ${query.organizationId ? Prisma.sql`AND p.organization_id = ${query.organizationId}::uuid` : Prisma.empty}
            ${query.status ? Prisma.sql`AND p.status = ${query.status}` : Prisma.empty}
            ${from ? Prisma.sql`AND p.created_at >= ${from}` : Prisma.empty}
            ${before ? Prisma.sql`AND p.created_at < ${before}` : Prisma.empty}
        ), page AS (
          SELECT * FROM matching ORDER BY "createdAt" DESC, id DESC
          OFFSET ${(query.page - 1) * query.pageSize} LIMIT ${query.pageSize}
        )
        SELECT (SELECT count(*)::int FROM matching) AS total,
          coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('organizationName', o.display_name)
            ORDER BY p."createdAt" DESC, p.id DESC), '[]'::jsonb) AS items
        FROM page p LEFT JOIN public.organizations o ON o.id = p."organizationId"`;
        return {
          ...result,
          page: query.page,
          pageSize: query.pageSize,
          items: result.items.map((item) => ({
            ...item,
            lastErrorCode: safeProvisioningError(item.lastErrorCode),
          })),
        };
      },
    );
  }

  subscriptions(
    call: CorporateCall,
    reference: unknown,
    query: SubscriptionListDto,
  ) {
    return this.read(
      call,
      reference,
      'SUBSCRIPTIONS',
      'LIST',
      query.organizationId,
      async (tx) => {
        const at = new Date();
        const rows = await tx.$queryRaw<(Subscription & { total: number })[]>`
        WITH matching AS MATERIALIZED (
          SELECT s.id, o.id AS "organizationId", o.display_name AS "organizationName", s.started_at
          FROM public.organizations o
          JOIN public.organization_subscriptions s ON s.id = public.app_platform_canonical_subscription_id(o.id)
          WHERE o.deleted_at IS NULL
            ${query.organizationId ? Prisma.sql`AND o.id = ${query.organizationId}::uuid` : Prisma.empty}
            ${query.planCode ? Prisma.sql`AND s.plan_code = ${query.planCode}` : Prisma.empty}
            ${query.billingInterval ? Prisma.sql`AND s.billing_interval = ${query.billingInterval}` : Prisma.empty}
            ${query.persistedStatus ? Prisma.sql`AND s.status = ${query.persistedStatus}` : Prisma.empty}
        ), page AS (
          SELECT * FROM matching ORDER BY started_at DESC, id DESC
          OFFSET ${(query.page - 1) * query.pageSize} LIMIT ${query.pageSize}
        )
        SELECT (SELECT count(*)::int FROM matching) AS total, s.id, p."organizationId", p."organizationName",
          s.status, s.version, s.plan_code AS "planCode", s.billing_interval AS "billingInterval",
          s.billing_anchor_at AS "billingAnchorAt", s.current_period_start AS "currentPeriodStart",
          s.current_period_end AS "currentPeriodEnd", s.trial_ends_at AS "trialEndsAt",
          s.grace_starts_at AS "graceStartsAt", s.grace_ends_at AS "graceEndsAt",
          s.cancel_at_period_end AS "cancelAtPeriodEnd", s.pending_effective_at AS "pendingEffectiveAt",
          s.pending_plan_code AS "pendingPlanCode", s.pending_billing_interval AS "pendingBillingInterval",
          (s.provider_subscription_id IS NOT NULL) AS "providerManaged"
        FROM (SELECT 1) anchor LEFT JOIN page p ON true
        LEFT JOIN public.organization_subscriptions s ON s.id = p.id
        ORDER BY p.started_at DESC, p.id DESC`;
        return {
          total: rows[0]!.total,
          page: query.page,
          pageSize: query.pageSize,
          asOf: at,
          items: rows
            .filter((row) => row.id !== null)
            .map((row) => {
              const effective = projectPlatformSubscription(row, at);
              return {
                id: row.id,
                organizationId: row.organizationId,
                organizationName: row.organizationName,
                version: row.version,
                planCode: row.planCode,
                billingInterval: row.billingInterval,
                persistedStatus: row.status,
                effectiveStatus: effective.status,
                effectivePlanCode: effective.planCode,
                effectiveBillingInterval: effective.billingInterval,
                currentPeriodEnd: effective.currentPeriodEnd,
                trialEndsAt: effective.trialEndsAt,
                cancelAtPeriodEnd: effective.cancelAtPeriodEnd,
                pendingChange: effective.pendingChange,
              };
            }),
        };
      },
    );
  }

  history(
    call: CorporateCall,
    reference: unknown,
    organizationId: string,
    query: ReceiptHistoryDto,
  ) {
    return this.read(
      call,
      reference,
      'RECEIPTS',
      'HISTORY',
      organizationId,
      async (tx, principal) => {
        const types = query.type
          ? [query.type]
          : receiptTypes.filter((type) => type !== 'PROMOTION');
        const queries = types.map((type) =>
          receiptQuery(type, principal, { organizationId }),
        );
        const [result] = await tx.$queryRaw<
          [{ items: Receipt[]; total: number }]
        >`
        WITH matching(id, "organizationId", type, operation, "createdAt", tie, outcome) AS MATERIALIZED (
          ${Prisma.join(queries, ' UNION ALL ')}
        )
        SELECT (SELECT count(*)::int FROM matching) AS total,
          coalesce((SELECT jsonb_agg(to_jsonb(p) - 'tie' ORDER BY p."createdAt" DESC, p.type, p.id DESC, p.tie)
            FROM (SELECT * FROM matching ORDER BY "createdAt" DESC, type, id DESC, tie
              OFFSET ${(query.page - 1) * query.pageSize} LIMIT ${query.pageSize}) p), '[]'::jsonb) AS items`;
        return {
          ...result,
          items: result.items.map(sanitizeReceipt),
          page: query.page,
          pageSize: query.pageSize,
        };
      },
    );
  }

  async lookup(
    call: CorporateCall,
    reference: unknown,
    query: ReceiptLookupDto,
    key: unknown,
  ) {
    if ((query.operationId !== undefined) === (key !== undefined))
      throw new BadRequestException(
        'Informe o identificador da operação ou a chave de idempotência.',
      );
    if (
      ['OPERATIONAL', 'COMMERCIAL'].includes(query.type) &&
      !query.organizationId
    )
      throw new BadRequestException('Informe a organização.');
    if (query.type === 'PROMOTION' && query.organizationId)
      throw new BadRequestException(
        'A operação promocional não pertence a uma organização.',
      );

    const operations =
      query.type === 'COMMERCIAL'
        ? ['CHANGE_PLAN', 'KEEP', 'CANCEL_SCHEDULED_CHANGE', 'START_TRIAL']
        : query.type === 'PROMOTION'
          ? ['CREATE', 'UPDATE', 'ACTIVATE', 'DEACTIVATE']
          : [];
    if (
      (query.operation && !operations.includes(query.operation)) ||
      (key !== undefined && operations.length && !query.operation)
    )
      throw new BadRequestException(
        'Informe o comando correspondente ao tipo de recibo.',
      );
    const receipt = await this.read(
      call,
      reference,
      'RECEIPTS',
      'LOOKUP',
      query.operationId ?? query.organizationId,
      async (tx, principal) => {
        let keyHash: string | undefined;
        if (key !== undefined) {
          const pattern =
            query.type === 'PROVISIONING'
              ? /^[A-Za-z0-9._:-]{1,128}$/
              : query.type === 'SUPPORT'
                ? /^[A-Za-z0-9_.:-]{16,128}$/
                : /^[A-Za-z0-9_-]{16,120}$/;
          if (typeof key !== 'string' || !pattern.test(key))
            throw new BadRequestException('Chave de idempotência inválida.');
          keyHash = createHash('sha256')
            .update(
              query.type === 'OPERATIONAL'
                ? JSON.stringify(['CORPORATE', principal, key])
                : key,
            )
            .digest('hex');
        }
        const source = receiptQuery(query.type, principal, {
          id: query.operationId,
          organizationId: query.organizationId,
          keyHash,
          operation: query.operation,
        });
        const [row] = await tx.$queryRaw<Receipt[]>`
        WITH matching(id, "organizationId", type, operation, "createdAt", tie, outcome) AS (${source})
        SELECT id, "organizationId", type, operation, "createdAt", outcome FROM matching
        ORDER BY "createdAt" DESC, id DESC, tie LIMIT 1`;
        return row ? sanitizeReceipt(row) : null;
      },
    );
    if (!receipt) throw new NotFoundException();
    return receipt;
  }

  private read<T>(
    call: CorporateCall,
    reference: unknown,
    scope: Scope,
    operation: string,
    target: string | undefined,
    run: (tx: PrismaTransactionClient, principal: string) => Promise<T>,
  ) {
    const audit = authorizedCorporateReference(
      call,
      reference,
      grants[scope],
      false,
    );
    return this.rls.runAmbient(
      async (tx) => {
        await tx.$queryRaw`SELECT
        set_config('app.corporate_completion_principal', ${audit.technicalPrincipalId}, true),
        set_config('app.corporate_completion_scope', ${scope}, true),
        set_config('statement_timeout', '5s', true)`;
        const value = await run(tx, audit.technicalPrincipalId);
        await tx.auditLog.createMany({
          data: {
            action: 'CORPORATE_ADMINISTRATIVE_READ',
            entityType: 'CORPORATE_ADMINISTRATIVE_READ',
            entityId: target,
            requestId: audit.correlationId,
            metadata: {
              ...audit,
              scope,
              operation,
              outcome: value === null ? 'NOT_FOUND' : 'CONFIRMED',
            },
          },
        });
        return value;
      },
      { timeout: 12_000 },
    );
  }
}
