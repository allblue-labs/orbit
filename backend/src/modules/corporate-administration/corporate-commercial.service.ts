import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { createHash } from 'node:crypto';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { BaseException, ConflictException } from '../../exceptions';
import { generateUuidV7 } from '../../utils';
import { BillingReadService } from '../billing/billing-read.service';
import { BillingService } from '../billing/billing.service';
import type { PlanLimit } from '../subscription-plans/catalog/plan-catalog.types';
import { CommercialPlanService } from '../subscription-plans/catalog/commercial-plan.service';
import { EntitlementMapper } from '../subscription-plans/entitlements/entitlement.mapper';
import { EntitlementService } from '../subscription-plans/entitlements/entitlement.service';
import { SubscriptionMapper } from '../subscription-plans/subscriptions/subscription.mapper';
import { SubscriptionService } from '../subscription-plans/subscriptions/subscription.service';
import { TrialEligibilityService } from '../subscription-plans/subscriptions/trial-eligibility.service';
import type { CorporateAuditReference } from '../platform-administration/corporate-organization.read-model';
import type { CorporateCall } from './corporate-access.guard';
import type {
  CorporatePlanCommandDto,
  CorporateSubscriptionCommandDto,
} from './corporate-commercial.dto';
import { authorizedCorporateReference } from './corporate-request';
import {
  PLANS_READ,
  SUBSCRIPTIONS_READ,
  SUBSCRIPTIONS_CHANGE_PLAN,
  SUBSCRIPTIONS_KEEP,
  SUBSCRIPTIONS_CANCEL_SCHEDULED_CHANGE,
  TRIALS_READ,
  TRIALS_MANAGE,
} from './technical-credential.service';

const commandCapabilities = {
  CHANGE_PLAN: SUBSCRIPTIONS_CHANGE_PLAN,
  KEEP: SUBSCRIPTIONS_KEEP,
  CANCEL_SCHEDULED_CHANGE: SUBSCRIPTIONS_CANCEL_SCHEDULED_CHANGE,
  START_TRIAL: TRIALS_MANAGE,
} as const;

type Command = keyof typeof commandCapabilities;
type Receipt = {
  id: string;
  organizationId: string;
  subscriptionId: string;
  subscriptionVersion: number;
  operation: Command;
  result: 'APPLIED' | 'AWAITING_REVIEW' | 'TRIAL_STARTED';
  ticketId: string | null;
  trialEndsAt: string | null;
};
type Decision = Pick<Receipt, 'result' | 'ticketId' | 'trialEndsAt'> & {
  originTicketId?: string;
};

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class CorporateCommercialService {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly catalog: CommercialPlanService,
    private readonly entitlements: EntitlementService,
    private readonly entitlementMapper: EntitlementMapper,
    private readonly subscriptions: SubscriptionService,
    private readonly subscriptionMapper: SubscriptionMapper,
    private readonly billing: BillingService,
    private readonly billingRead: BillingReadService,
    private readonly trials: TrialEligibilityService,
  ) {}

  async plans(
    call: CorporateCall,
    reference: unknown,
    organizationId?: string,
    id?: string,
  ) {
    const audit = authorizedCorporateReference(
      call,
      reference,
      PLANS_READ,
      false,
    );
    const uuid = id !== undefined && isUUID(id);
    if (id !== undefined && !uuid && !/^[A-Z][A-Z0-9_]{1,39}$/.test(id))
      throw new BadRequestException('Identificador do plano inválido.');
    const identifier =
      id === undefined ? undefined : uuid ? { id } : { key: id };
    const result = await this.scoped(
      audit,
      organizationId,
      async () => {
        return (
          await this.catalog.catalogEntries(organizationId, identifier)
        ).map(({ id, offer }) => ({
          id,
          ...this.entitlementMapper.plan(offer),
          organizationId: offer.tenantId,
          checkoutIntervals: Object.entries(offer.prices)
            .filter(([, price]) => !!price.stripePriceId)
            .map(([interval]) => interval),
        }));
      },
      'PLANS',
      (value) => (id && value.length === 0 ? 'NOT_FOUND' : 'CONFIRMED'),
    );
    if (id && !result[0]) throw new NotFoundException();
    return result;
  }

  subscription(
    call: CorporateCall,
    reference: unknown,
    organizationId: string,
  ) {
    const audit = authorizedCorporateReference(
      call,
      reference,
      SUBSCRIPTIONS_READ,
      false,
    );
    return this.scoped(
      audit,
      organizationId,
      async (tx, organization) => {
        const retained =
          !!organization?.dataPurgeStartedAt || !!organization?.dataPurgedAt;
        const subscription =
          await this.subscriptions.currentOrLast(organizationId);
        const details = subscription
          ? this.subscriptionMapper.details(subscription)
          : null;
        const stored = subscription
          ? await tx.organizationSubscription.findFirst({
              where: { id: subscription.id, organizationId },
              select: { planCode: true, status: true, billingInterval: true },
            })
          : null;
        const rights = await this.entitlements.resolve(organizationId);
        const customerBilling =
          await this.billingRead.readiness(organizationId);
        const latestInvoice = subscription
          ? await tx.billingInvoice.findFirst({
              where: { organizationId, subscriptionId: subscription.id },
              select: {
                status: true,
                currency: true,
                amountPaidMinor: true,
                amountRemainingMinor: true,
                paidAt: true,
                periodStart: true,
                periodEnd: true,
              },
              orderBy: [{ providerCreatedAt: 'desc' }, { id: 'desc' }],
            })
          : null;
        const outstandingCheckout = await this.checkoutStatus(
          tx,
          organizationId,
        );
        const pendingUpgrade = subscription
          ? await tx.billingPlanUpgrade.findFirst({
              where: {
                organizationId,
                subscriptionId: subscription.id,
                status: 'OPEN',
              },
              select: { status: true },
            })
          : null;
        const pendingRefund = subscription
          ? await tx.billingRefundRequest.findFirst({
              where: { organizationId, subscriptionId: subscription.id },
              select: { status: true },
            })
          : null;
        return {
          organizationId,
          subscription:
            details && subscription && stored
              ? {
                  ...details,
                  persistedStatus: stored.status,
                  effectiveStatus: subscription.effectiveStatus,
                  persistedPlanCode: stored.planCode,
                  persistedBillingInterval: stored.billingInterval,
                  catalogVersion: subscription.catalogVersion,
                  providerManaged: !!subscription.providerSubscriptionId,
                  current: subscription.endedAt === null,
                }
              : null,
          payment: {
            source: 'LOCAL_BILLING_RECORDS' as const,
            latestInvoice,
            checkout: outstandingCheckout,
            upgradePending: pendingUpgrade !== null,
            refundStatus: pendingRefund?.status ?? null,
          },
          customerBilling: {
            configured: customerBilling.configured,
            allowedActions: customerBilling.allowedActions,
            canCheckout: customerBilling.canCheckout,
            canOpenBillingPortal: customerBilling.canOpenBillingPortal,
          },
          entitlements: {
            source: rights.source,
            planCode: rights.planCode,
            label: rights.label,
            accessGranted: rights.accessGranted,
            capabilities: [...rights.capabilities].sort(),
            allocation: this.limits(rights.allocation),
            usage: this.limits(rights.usage),
          },
          corporateActions: {
            changePlan:
              !retained &&
              customerBilling.configured &&
              details?.allowedActions.includes('CHANGE_PLAN') &&
              subscription?.effectiveStatus === 'ACTIVE'
                ? 'REVIEW_IF_ELIGIBLE'
                : 'UNAVAILABLE',
            cancel: 'CUSTOMER_CONFIRMATION_REQUIRED',
            keep: this.localAction(
              !retained &&
                (details?.allowedActions.includes('KEEP_SUBSCRIPTION') ??
                  false),
              !!subscription?.providerSubscriptionId,
              !!outstandingCheckout || !!pendingUpgrade || !!pendingRefund,
            ),
            cancelScheduledChange: this.localAction(
              !retained &&
                (details?.allowedActions.includes('CANCEL_SCHEDULED_CHANGE') ??
                  false),
              !!subscription?.providerSubscriptionId,
              !!outstandingCheckout || !!pendingUpgrade || !!pendingRefund,
            ),
          },
        };
      },
      'SUBSCRIPTION',
    );
  }

  trial(
    call: CorporateCall,
    reference: unknown,
    organizationId: string,
    includeDetails = false,
  ) {
    const audit = authorizedCorporateReference(
      call,
      reference,
      TRIALS_READ,
      false,
    );
    return this.scoped(
      audit,
      organizationId,
      async (tx, organization) => {
        const active = await this.subscriptions.currentOrNull(organizationId);
        const last =
          active ?? (await this.subscriptions.currentOrLast(organizationId));
        let blockedReason = !active
          ? 'NO_CURRENT_SUBSCRIPTION'
          : organization?.dataPurgeStartedAt || organization?.dataPurgedAt
            ? 'DATA_RETENTION'
            : active.effectiveStatus !== 'PENDING_PAYMENT'
              ? 'NOT_AWAITING_PAYMENT'
              : active.providerSubscriptionId
                ? 'PROVIDER_MANAGED'
                : active.cancelAtPeriodEnd
                  ? 'CANCELLATION_SCHEDULED'
                  : !this.billing.isEnabled()
                    ? 'BILLING_UNAVAILABLE'
                    : (await this.checkoutStatus(tx, organizationId))
                      ? 'CHECKOUT_OPEN'
                      : await this.trials.pendingTrialBlock(organizationId);
        const offers = (await this.catalog.list(organizationId)).filter(
          (offer) => offer.isActive && offer.trialDays > 0,
        );
        const history = await tx.subscriptionTrialGrant.findMany({
          where: { organizationId },
          select: {
            planCode: true,
            grantedAt: true,
            startsAt: true,
            endsAt: true,
            status: true,
          },
          orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
          take: 25,
        });
        if (!blockedReason && !offers.length)
          blockedReason = 'NO_ACTIVE_TRIAL_OFFER';
        return {
          organizationId,
          subscriptionId: active?.id ?? null,
          subscriptionVersion: active?.version ?? null,
          effectiveStatus: last?.effectiveStatus ?? null,
          currentTrial: last
            ? this.subscriptionMapper.details(last).trial
            : null,
          offers: offers.map((offer) => ({
            planCode: offer.code,
            catalogVersion: offer.version,
            trialDays: offer.trialDays,
          })),
          canStart: blockedReason === null,
          ...(includeDetails ? { blockedReason } : {}),
          history,
        };
      },
      'TRIAL',
    );
  }

  async operation(
    call: CorporateCall,
    reference: unknown,
    organizationId: string,
    id: string,
  ) {
    const audit = authorizedCorporateReference(
      call,
      reference,
      SUBSCRIPTIONS_READ,
      false,
    );
    const result = await this.scoped(
      audit,
      organizationId,
      async (tx) => {
        const row = await tx.corporateCommercialCommand.findFirst({
          where: {
            id,
            organizationId,
            technicalPrincipalId: audit.technicalPrincipalId,
          },
        });
        if (!row) return null;
        const receipt = row.result as Receipt;
        const review = receipt.ticketId
          ? await tx.billingSupportTicket.findFirst({
              where: { id: receipt.ticketId, organizationId },
              select: { status: true },
            })
          : null;
        return {
          ...receipt,
          createdAt: row.createdAt.toISOString(),
          reviewStatus: review?.status ?? null,
        };
      },
      'OPERATION',
      (value) => (value ? 'CONFIRMED' : 'NOT_FOUND'),
    );
    if (!result) throw new NotFoundException();
    return result;
  }

  async write(
    call: CorporateCall,
    reference: unknown,
    organizationId: string,
    operation: Command,
    key: unknown,
    input: CorporateSubscriptionCommandDto | CorporatePlanCommandDto,
  ) {
    const audit = authorizedCorporateReference(
      call,
      reference,
      commandCapabilities[operation],
      true,
    );
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,120}$/.test(key))
      throw new BadRequestException(
        'Informe uma chave de idempotência válida.',
      );
    input = {
      ...input,
      expectedSubscriptionId: input.expectedSubscriptionId.toLowerCase(),
    };
    const plan =
      'planCode' in input
        ? {
            planCode: input.planCode,
            expectedCatalogVersion: input.expectedCatalogVersion,
            billingInterval: input.billingInterval,
          }
        : undefined;
    const keyHash = digest(key);
    const requestHash = digest(
      JSON.stringify({
        subscriptionId: input.expectedSubscriptionId,
        version: input.expectedVersion,
        reason: input.reason,
        ...plan,
      }),
    );
    const details = {
      reason: input.reason,
      subscriptionId: input.expectedSubscriptionId,
    };
    // A separately committed attempt can be correlated even if the command transaction fails.
    await this.scoped(audit, organizationId, async (tx) => {
      await this.audit(
        tx,
        audit,
        organizationId,
        'ATTEMPT',
        operation,
        'STARTED',
        details,
      );
    });
    try {
      return await this.scoped(audit, organizationId, async (tx) => {
        const principal = audit.technicalPrincipalId;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(
          ${['corporate-commercial', organizationId, principal, operation, keyHash].join(':')}, 0))::text`;
        const previous = await tx.corporateCommercialCommand.findFirst({
          where: {
            organizationId,
            technicalPrincipalId: principal,
            operation,
            keyHash,
          },
        });
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new ConflictException(
              'Chave já usada para outro comando.',
              'IDEMPOTENCY_MISMATCH',
            );
          await this.audit(
            tx,
            audit,
            organizationId,
            'RESULT',
            operation,
            'REPLAYED',
            details,
            previous.id,
          );
          return {
            ...(previous.result as Receipt),
            createdAt: previous.createdAt.toISOString(),
            replayed: true,
          };
        }
        await this.lockContract(tx, organizationId, input);
        const { originTicketId, ...decision } = await this.apply(
          tx,
          organizationId,
          operation,
          input,
          plan,
        );
        const current = await this.subscriptions.requireCurrent(organizationId);
        const id = generateUuidV7();
        const receipt: Receipt = {
          id,
          organizationId,
          operation,
          subscriptionId: current.id,
          subscriptionVersion: current.version,
          ...decision,
        };
        const row = await tx.corporateCommercialCommand.create({
          data: {
            id,
            operation,
            organizationId,
            technicalPrincipalId: principal,
            keyHash,
            requestHash,
            originTicketId,
            result: receipt,
          },
          select: { createdAt: true },
        });
        await this.audit(
          tx,
          audit,
          organizationId,
          'RESULT',
          operation,
          decision.result,
          details,
          id,
        );
        return {
          ...receipt,
          createdAt: row.createdAt.toISOString(),
          replayed: false,
        };
      });
    } catch (error) {
      const busy =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034';
      const failure = busy ? this.billingBusy() : error;
      const outcome =
        failure instanceof HttpException && failure.getStatus() < 500
          ? 'REJECTED'
          : 'UNCONFIRMED';
      await this.scoped(audit, organizationId, (tx) =>
        this.audit(tx, audit, organizationId, 'RESULT', operation, outcome, {
          ...details,
          code:
            failure instanceof BaseException ? failure.code : 'REQUEST_FAILED',
        }),
      );
      throw failure;
    }
  }

  private async lockContract(
    tx: PrismaTransactionClient,
    organizationId: string,
    input: CorporateSubscriptionCommandDto,
  ) {
    // Checkout, canonical writes and retention use the same tenant lock. The
    // row lock also serializes provider observations that don't bump version.
    // Do not wait for a customer billing command that took the row lock first.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))::text`;
    const organization = await this.organization(tx, organizationId);
    if (!organization) throw new NotFoundException();
    if (organization.dataPurgeStartedAt || organization.dataPurgedAt)
      throw new ConflictException(
        'Os dados da organização estão em retenção ou já foram removidos.',
      );
    const [current] = await tx.$queryRaw<{ version: number }[]>`
      SELECT version FROM organization_subscriptions
      WHERE id = ${input.expectedSubscriptionId}::uuid
        AND organization_id = ${organizationId}::uuid AND ended_at IS NULL
      FOR UPDATE SKIP LOCKED`;
    if (!current) {
      const locked = await tx.organizationSubscription.findFirst({
        where: {
          id: input.expectedSubscriptionId,
          organizationId,
          version: input.expectedVersion,
          endedAt: null,
        },
        select: { id: true },
      });
      if (locked) throw this.billingBusy();
    }
    if (current?.version !== input.expectedVersion)
      throw new ConflictException(
        'Versão da assinatura desatualizada.',
        'STALE_VERSION',
      );
  }

  private billingBusy() {
    return new BaseException(
      {
        code: 'BILLING_BUSY',
        message: 'A assinatura está sendo processada.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  private async apply(
    tx: PrismaTransactionClient,
    organizationId: string,
    operation: Command,
    input: CorporateSubscriptionCommandDto,
    plan?: Pick<
      CorporatePlanCommandDto,
      'planCode' | 'expectedCatalogVersion' | 'billingInterval'
    >,
  ): Promise<Decision> {
    const { expectedVersion, expectedSubscriptionId: subscriptionId } = input;
    if (plan && (operation === 'CHANGE_PLAN' || operation === 'START_TRIAL')) {
      // Match the catalog publication lock so the quote checked here stays current.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'plan:' + plan.planCode}, 0))::text`;
      const request = { ...plan, expectedVersion, organizationId };
      if (operation === 'CHANGE_PLAN') {
        const review = await this.billing.requestPlanChangeReview(
          request,
          subscriptionId,
        );
        return {
          result: 'AWAITING_REVIEW',
          ticketId: review.ticketId,
          originTicketId: review.created ? review.ticketId : undefined,
          trialEndsAt: null,
        };
      }
      const trial = await this.billing.startLocalTrial(
        request,
        subscriptionId,
        tx,
      );
      return {
        result: 'TRIAL_STARTED',
        ticketId: null,
        trialEndsAt: trial.trialEndsAt!.toISOString(),
      };
    }
    if (operation !== 'KEEP' && operation !== 'CANCEL_SCHEDULED_CHANGE')
      throw new BadRequestException('Informe o plano comercial.');
    const current = await this.subscriptions.requireCurrent(organizationId);
    if (current.providerSubscriptionId)
      throw new ConflictException(
        'A assinatura é gerida pelo provedor de pagamento.',
        'BILLING_COMMAND_NOT_ALLOWED',
      );
    if (await this.checkoutStatus(tx, organizationId))
      throw new ConflictException(
        'Existe uma contratação em andamento.',
        'BILLING_COMMAND_NOT_ALLOWED',
      );
    if (operation === 'KEEP')
      await this.billing.keepSubscription(
        organizationId,
        expectedVersion,
        subscriptionId,
      );
    else
      await this.billing.cancelScheduledPlanChange(
        organizationId,
        expectedVersion,
        subscriptionId,
      );
    return { result: 'APPLIED', ticketId: null, trialEndsAt: null };
  }

  private checkoutStatus(tx: PrismaTransactionClient, organizationId: string) {
    return tx.billingCheckoutAttempt.findFirst({
      where: { organizationId, status: { in: ['CREATING', 'OPEN'] } },
      select: { status: true, expiresAt: true },
    });
  }

  private organization(tx: PrismaTransactionClient, id: string) {
    return tx.organization.findFirst({
      where: { id, deletedAt: null },
      select: { dataPurgeStartedAt: true, dataPurgedAt: true },
    });
  }

  private limits(values: Readonly<Record<string, PlanLimit>>) {
    return Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        this.entitlementMapper.limit(value),
      ]),
    );
  }

  private localAction(
    allowed: boolean,
    providerManaged: boolean,
    pending: boolean,
  ) {
    if (!allowed) return 'UNAVAILABLE';
    if (providerManaged) return 'PROVIDER_FLOW_REQUIRED';
    return pending ? 'PAYMENT_IN_PROGRESS' : 'AVAILABLE';
  }

  private async scoped<T>(
    audit: CorporateAuditReference,
    organizationId: string | undefined,
    work: (
      tx: PrismaTransactionClient,
      organization: {
        dataPurgeStartedAt: Date | null;
        dataPurgedAt: Date | null;
      } | null,
    ) => Promise<T>,
    read?: string,
    outcome: (value: T) => string = () => 'CONFIRMED',
  ): Promise<T> {
    const result = await this.rls.runAmbient(async (tx) => {
      await tx.$queryRaw`SELECT
        set_config('app.organization_id', ${organizationId ?? ''}, true),
        set_config('app.corporate_commercial_principal', ${audit.technicalPrincipalId}, true)`;
      const organization = organizationId
        ? await this.organization(tx, organizationId)
        : null;
      if (organizationId && !organization) {
        await this.audit(
          tx,
          audit,
          null,
          'READ',
          read ?? 'ORGANIZATION',
          'NOT_FOUND',
          {},
          organizationId,
        );
        return null;
      }
      const data = await work(tx, organization);
      if (read)
        await this.audit(
          tx,
          audit,
          organizationId ?? null,
          'READ',
          read,
          outcome(data),
        );
      return { data };
    });
    if (!result) throw new NotFoundException();
    return result.data;
  }

  private audit(
    tx: PrismaTransactionClient,
    audit: CorporateAuditReference,
    organizationId: string | null,
    phase: 'READ' | 'ATTEMPT' | 'RESULT',
    operation: string,
    result: string,
    detail: Prisma.InputJsonObject = {},
    id?: string,
  ) {
    return tx.auditLog.createMany({
      data: {
        organizationId,
        entityId: id ?? organizationId,
        action: 'CORPORATE_COMMERCIAL_' + phase,
        entityType: 'CORPORATE_COMMERCIAL',
        requestId: audit.correlationId,
        metadata: { ...audit, operation, result, ...detail },
      },
    });
  }
}
