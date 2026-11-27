import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ConflictException } from '../../exceptions';
import {
  BILLING_PROVIDER,
  type BillingProvider,
} from '../billing/billing.types';
import { BillingRecoveryService } from '../billing/billing-recovery.service';
import {
  EMAIL_CONFIGURATION,
  emailRoute,
  type EmailConfiguration,
} from '../email/email.config';
import { PlatformAdministrationService } from '../platform-administration/platform-administration.service';
import { PlanConfigurationInvalidException } from '../subscription-plans/entitlements/entitlement.errors';
import { EntitlementMapper } from '../subscription-plans/entitlements/entitlement.mapper';
import { EntitlementService } from '../subscription-plans/entitlements/entitlement.service';
import { SubscriptionService } from '../subscription-plans/subscriptions/subscription.service';
import { grantsProductAccess } from '../subscription-plans/subscriptions/subscription.types';
import type { CorporateCall } from './corporate-access.guard';
import { CorporateSupportAccess } from './corporate-support-access.service';
import {
  diagnosticRows,
  safeProvisioningError,
  type DiagnosticOperation,
} from './corporate-diagnostics.queries';
import type {
  DiagnosticOperationsQuery,
  ResumeSupportProvisioningDto,
} from './corporate-support.dto';
import { RECOVERY_PROVISIONING_RESUME } from './technical-credential.service';

type Observation = Pick<
  DiagnosticOperation,
  'type' | 'mode' | 'status' | 'lastExecutionAt'
> & {
  count: number;
  maxAttempts: number;
  lastCompletedAt: Date | null;
};

@Injectable()
export class CorporateDiagnosticsService {
  constructor(
    private readonly access: CorporateSupportAccess,
    private readonly subscriptions: SubscriptionService,
    private readonly entitlements: EntitlementService,
    private readonly mapper: EntitlementMapper,
    private readonly platform: PlatformAdministrationService,
    private readonly recovery: BillingRecoveryService,
    @Inject(BILLING_PROVIDER) private readonly billing: BillingProvider,
    @Inject(EMAIL_CONFIGURATION) private readonly email: EmailConfiguration,
  ) {}

  organization(call: CorporateCall, reference: unknown, id: string) {
    return this.access.read(
      call,
      reference,
      'ORG_DIAGNOSTICS',
      id,
      async (tx) => {
        const org = await tx.organization.findFirst({
          where: { id, deletedAt: null },
          select: {
            id: true,
            displayName: true,
            status: true,
            ownerUserId: true,
            dataPurgeStartedAt: true,
            dataPurgedAt: true,
          },
        });
        if (!org) return null;
        const asOf = new Date();
        const issues: string[] = [];
        const subscription = await this.subscriptions
          .currentOrLast(id, asOf)
          .catch((error: unknown) => {
            if (!(error instanceof PlanConfigurationInvalidException))
              throw error;
            issues.push('SUBSCRIPTION_CONFIGURATION_INVALID');
            return null;
          });
        const stored = subscription
          ? await tx.organizationSubscription.findFirst({
              where: { id: subscription.id, organizationId: id },
              select: {
                status: true,
                planCode: true,
                pendingPlanCode: true,
                pendingEffectiveAt: true,
                provider: true,
                providerCustomerId: true,
                providerSubscriptionId: true,
                providerUpdatedAt: true,
                recurringObservation: true,
              },
            })
          : null;
        const rights = await this.entitlements
          .resolve(id)
          .catch((error: unknown) => {
            if (!(error instanceof PlanConfigurationInvalidException))
              throw error;
            issues.push('ENTITLEMENTS_CONFIGURATION_INVALID');
            return null;
          });
        const owner = await tx.user.findFirst({
          where: { id: org.ownerUserId, deletedAt: null },
          select: {
            status: true,
            emailVerifiedAt: true,
            credential: { select: { mustChangePassword: true } },
          },
        });
        const provisioning = await tx.platformTenantProvisioning.findFirst({
          where: { organizationId: id },
          select: {
            id: true,
            status: true,
            attempts: true,
            updatedAt: true,
            completedAt: true,
            lastErrorCode: true,
          },
        });
        const [counts] = await tx.$queryRaw<
          {
            commercial: number;
            administrative: number;
            checkout: number;
            upgrades: number;
          }[]
        >`
          SELECT (SELECT count(*)::int FROM public.billing_support_tickets WHERE organization_id = ${id}::uuid AND status = 'OPEN') AS commercial,
            (SELECT count(*)::int FROM public.corporate_support_tickets WHERE organization_id = ${id}::uuid AND status = 'OPEN') AS administrative,
            (SELECT count(*)::int FROM public.billing_checkout_attempts WHERE organization_id = ${id}::uuid AND status IN ('CREATING','OPEN')) AS checkout,
            (SELECT count(*)::int FROM public.billing_plan_upgrades WHERE organization_id = ${id}::uuid AND status = 'OPEN') AS upgrades
        `;
        const refunds = await tx.billingRefundRequest.groupBy({
          by: ['status'],
          where: { organizationId: id },
          _count: { _all: true },
        });
        const binding =
          stored?.provider === 'STRIPE' &&
          stored.providerCustomerId &&
          stored.providerSubscriptionId
            ? await tx.billingCustomer.findFirst({
                where: {
                  organizationId: id,
                  provider: 'STRIPE',
                  providerCustomerId: stored.providerCustomerId,
                  mode: { in: ['TEST', 'LIVE'] },
                },
                select: { mode: true },
              })
            : null;
        const invoice =
          binding && subscription
            ? await tx.billingInvoice.aggregate({
                where: {
                  organizationId: id,
                  subscriptionId: subscription.id,
                  provider: 'STRIPE',
                  mode: binding.mode,
                },
                _max: { providerObservedAt: true },
              })
            : null;
        if (stored?.provider === 'STRIPE' && !binding)
          issues.push('STRIPE_BINDING_UNVERIFIED');
        if (
          stored &&
          subscription &&
          (stored.status !== subscription.effectiveStatus ||
            stored.planCode !== subscription.planCode)
        )
          issues.push('SUBSCRIPTION_PROJECTION_DIFFERS');
        if (!owner) issues.push('OWNER_UNAVAILABLE');
        if (provisioning && provisioning.status !== 'COMPLETED')
          issues.push('PROVISIONING_INCOMPLETE');
        const effective = subscription?.effectiveStatus;
        return {
          asOf,
          organization: {
            id,
            displayName: org.displayName,
            operationalStatus: org.status,
            retention: org.dataPurgedAt
              ? 'PURGED'
              : org.dataPurgeStartedAt
                ? 'PURGE_STARTED'
                : 'NOT_OBSERVED',
          },
          owner: owner
            ? {
                status: owner.status,
                emailVerified: owner.emailVerifiedAt !== null,
                passwordSetupRequired:
                  owner.credential?.mustChangePassword ?? null,
              }
            : null,
          subscription:
            stored && subscription
              ? {
                  id: subscription.id,
                  persistedStatus: stored.status,
                  effectiveStatus: subscription.effectiveStatus,
                  persistedPlanCode: stored.planCode,
                  effectivePlanCode: subscription.planCode,
                  billingInterval: subscription.billingInterval,
                  currentPeriodEnd: subscription.currentPeriodEnd,
                  accessGranted: grantsProductAccess(
                    subscription.effectiveStatus,
                  ),
                }
              : null,
          billingAccess: !effective
            ? 'UNOBSERVED'
            : !grantsProductAccess(effective)
              ? 'BLOCKED'
              : effective === 'PAST_DUE' || effective === 'GRACE_PERIOD'
                ? 'PAYMENT_ATTENTION'
                : 'NO_BLOCK_OBSERVED',
          entitlements: rights
            ? {
                source: rights.source,
                planCode: rights.planCode,
                accessGranted: rights.accessGranted,
                capabilities: [...rights.capabilities].sort(),
                allocation: Object.fromEntries(
                  Object.entries(rights.allocation).map(([k, v]) => [
                    k,
                    this.mapper.limit(v),
                  ]),
                ),
                usage: Object.fromEntries(
                  Object.entries(rights.usage).map(([k, v]) => [
                    k,
                    this.mapper.limit(v),
                  ]),
                ),
              }
            : null,
          provisioning: provisioning
            ? {
                ...provisioning,
                lastErrorCode: safeProvisioningError(
                  provisioning.lastErrorCode,
                ),
              }
            : null,
          pending: {
            scheduledPlanChange: stored?.pendingPlanCode
              ? {
                  planCode: stored.pendingPlanCode,
                  effectiveAt: stored.pendingEffectiveAt,
                }
              : null,
            checkout: counts!.checkout,
            upgrades: counts!.upgrades,
            refunds: refunds.map((row) => ({
              status: row.status,
              count: row._count._all,
            })),
          },
          openTickets: {
            commercial: counts!.commercial,
            administrative: counts!.administrative,
          },
          lastReconciliation: {
            mode: binding?.mode ?? null,
            subscriptionObservedAt: binding
              ? this.subscriptionObservedAt(stored)
              : null,
            invoiceObservedAt: invoice?._max.providerObservedAt ?? null,
          },
          inconsistencies: issues,
        };
      },
    );
  }

  integrations(call: CorporateCall, reference: unknown) {
    return this.access.read(
      call,
      reference,
      'INTEGRATIONS',
      null,
      async (tx) => {
        const streams = await tx.$queryRaw<
          Observation[]
        >`${diagnosticRows({}, undefined, true)}
        SELECT type, mode, status, count(*)::int AS count, max(attempts) AS "maxAttempts",
          max("lastExecutionAt") AS "lastExecutionAt", max("completedAt") AS "lastCompletedAt"
        FROM filtered GROUP BY type, mode, status ORDER BY type, mode, status`;
        const stripe = streams.filter(
          (row) =>
            row.type === 'STRIPE_WEBHOOK' || row.type === 'STRIPE_RECOVERY',
        );
        const email = streams.filter(
          (row) =>
            row.type === 'IDENTITY_EMAIL' || row.type === 'CONTACT_EMAIL',
        );
        const sesConfigured =
          this.email.provider === 'ses' &&
          !!(
            this.email.region &&
            this.email.accessKeyId &&
            this.email.secretAccessKey &&
            emailRoute(this.email).from
          );
        return {
          asOf: new Date(),
          integrations: [
            {
              integration: 'STRIPE',
              configuration: this.billing.isEnabled()
                ? 'CONFIGURED'
                : 'DISABLED',
              mode: this.billing.mode,
              recoveryConfigured: this.recovery.settings.enabled,
              evidence: stripe.length ? 'LOCAL_RECORDS' : 'UNOBSERVED',
              streams: stripe,
            },
            {
              integration: 'SES',
              configuration: sesConfigured
                ? 'CONFIGURED'
                : this.email.provider === 'noop'
                  ? 'DISABLED'
                  : 'UNCONFIGURED',
              mode: null,
              recoveryConfigured: null,
              evidence: email.length ? 'LOCAL_RECORDS' : 'UNOBSERVED',
              streams: email,
            },
          ],
        };
      },
    );
  }

  operations(
    call: CorporateCall,
    reference: unknown,
    query: DiagnosticOperationsQuery,
  ) {
    return this.access.read(
      call,
      reference,
      'OPERATIONS',
      query.organizationId ?? null,
      async (tx) => {
        const { page, pageSize } = query;
        const sql = diagnosticRows(query);
        if (!sql) return { page, pageSize, total: 0, items: [] };
        const [result] = await tx.$queryRaw<
          { total: number; items: DiagnosticOperation[] }[]
        >`${sql}
        SELECT (SELECT count(*)::int FROM filtered) AS total,
          coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p."updatedAt" DESC, p.type, p.id) FROM (
           SELECT * FROM filtered ORDER BY "updatedAt" DESC, type, id OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
          ) p), '[]'::jsonb) AS items`;
        return { ...result, page, pageSize };
      },
    );
  }

  operation(call: CorporateCall, reference: unknown, id: string) {
    if (!isUUID(id) && !/^STRIPE:(TEST|LIVE):(EVENTS|SUBSCRIPTIONS)$/.test(id))
      throw new BadRequestException('Identificador de operação inválido.');
    return this.access.read(
      call,
      reference,
      'OPERATIONS',
      isUUID(id) ? id : null,
      async (tx) => {
        const [result] = await tx.$queryRaw<
          DiagnosticOperation[]
        >`${diagnosticRows({}, id)}
        SELECT * FROM filtered ORDER BY type LIMIT 1`;
        return result ?? null;
      },
    );
  }

  resume(
    call: CorporateCall,
    reference: unknown,
    id: string,
    key: unknown,
    input: ResumeSupportProvisioningDto,
  ) {
    const { expectedVersion, reason } = input;
    return this.access.write(
      call,
      reference,
      'PROVISIONING_RECOVERY',
      id,
      key,
      { expectedVersion, reason },
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.corporate_provisioner', ${call.principal.id}, true)`;
        const previous = await tx.platformTenantProvisioning.findFirst({
          where: { id, technicalPrincipalId: call.principal.id },
          select: { status: true, version: true },
        });
        if (!previous) throw new NotFoundException();
        if (previous.version !== expectedVersion)
          throw new ConflictException(
            'O provisionamento foi atualizado.',
            'STALE_VERSION',
          );
        if (
          previous.status !== 'TENANT_CREATED' &&
          previous.status !== 'SUBSCRIPTION_READY'
        )
          throw new ConflictException(
            'O estágio atual não permite retomada.',
            'PROVISIONING_NOT_RESUMABLE',
          );
        const result = await this.platform.resumeCorporateProvisioning(
          call,
          reference,
          id,
          RECOVERY_PROVISIONING_RESUME,
        );
        return {
          id,
          status: result.status,
          version: result.version,
          attempts: result.attempts,
          complete: result.complete,
          lastErrorCode: safeProvisioningError(result.lastErrorCode),
        };
      },
      reason,
    );
  }

  private subscriptionObservedAt(
    stored: {
      providerUpdatedAt: Date | null;
      recurringObservation: unknown;
    } | null,
  ) {
    const snapshot = stored?.recurringObservation as {
      observedAt?: unknown;
    } | null;
    const observed =
      typeof snapshot?.observedAt === 'string'
        ? Date.parse(snapshot.observedAt)
        : NaN;
    const updated = stored?.providerUpdatedAt?.getTime() ?? -Infinity;
    const latest = Math.max(
      Number.isFinite(observed) ? observed : -Infinity,
      updated,
    );
    return Number.isFinite(latest) ? new Date(latest) : null;
  }
}
