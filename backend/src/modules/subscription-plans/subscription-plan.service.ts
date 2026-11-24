import { Injectable, Optional } from '@nestjs/common';
import { HotpathSnapshot } from '../../common/hotpath/hotpath-snapshot';
import type { Prisma } from '@prisma/client';
import {
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import type { CreatePlanDto, UpdatePlanDto } from './subscription-plan.dto';
import {
  type PlanTenantAccess,
  SubscriptionPlanRepository,
} from './subscription-plan.repository';
import { SubscriptionExpiredException } from './subscription-expired.exception';
import { project } from './subscriptions/subscription.projection';

export interface OrganizationEntitlements {
  planKey: string;
  subscriptionStatus: string;
  capabilities: readonly string[];
  limits: Readonly<Record<string, number | null>>;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

interface CachedEntitlements extends Omit<
  OrganizationEntitlements,
  'currentPeriodStart' | 'currentPeriodEnd'
> {
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  expiresAt: number;
}

@Injectable()
export class SubscriptionPlanService {
  private static readonly ALLOWED_STATUSES = new Set([
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'GRACE_PERIOD',
  ]);

  constructor(
    private readonly repository: SubscriptionPlanRepository,
    @Optional() private readonly hotpath?: HotpathSnapshot,
  ) {}

  listPlans() {
    return this.repository.listActive();
  }

  createPlan(input: CreatePlanDto) {
    this.validateLimits(input.limits);
    return this.repository.createPlan({
      key: input.key.toUpperCase(),
      name: input.name,
      description: input.description,
      monthlyPrice: input.monthlyPrice,
      annualPrice: input.annualPrice,
      currency: input.currency?.toUpperCase() ?? 'BRL',
      capabilities: input.capabilities ?? [],
      limits: input.limits ?? {},
      isActive: input.isActive ?? true,
    });
  }

  updatePlan(id: string, input: UpdatePlanDto) {
    this.validateLimits(input.limits);
    return this.repository.updatePlan(id, {
      key: input.key?.toUpperCase(),
      name: input.name,
      description: input.description,
      monthlyPrice: input.monthlyPrice,
      annualPrice: input.annualPrice,
      currency: input.currency?.toUpperCase(),
      capabilities: input.capabilities,
      limits: input.limits,
      isActive: input.isActive,
    });
  }

  async getEntitlements(
    organizationId: string,
    access?: PlanTenantAccess,
    checked?: { sessionId: string; billingVersion: string },
  ): Promise<OrganizationEntitlements> {
    const hotpath = this.hotpath;
    if (!checked || !access || !hotpath?.available)
      return this.loadEntitlements(organizationId, access);

    const key = `orbit:v1:org:${organizationId}:plan:${checked.billingVersion}`;
    const cached = await hotpath.read<CachedEntitlements>(key);
    if (cached && cached.expiresAt > Date.now()) {
      const { expiresAt: _expiresAt, ...value } = cached;
      return {
        ...value,
        currentPeriodStart: value.currentPeriodStart
          ? new Date(value.currentPeriodStart)
          : null,
        currentPeriodEnd: value.currentPeriodEnd
          ? new Date(value.currentPeriodEnd)
          : null,
      };
    }
    let expiresAt = Date.now() + 120_000;
    const value = await this.loadEntitlements(
      organizationId,
      access,
      (transition) => {
        expiresAt = Math.min(expiresAt, transition);
      },
    );
    if (hotpath.available && expiresAt - Date.now() >= 1_000) {
      const current = await hotpath.fence(checked.sessionId, access.userId);
      if (
        current?.cacheable &&
        current.organizationId === organizationId &&
        current.billingVersion === checked.billingVersion
      ) {
        await hotpath.write(
          key,
          { ...value, expiresAt },
          Math.max(1, Math.ceil((expiresAt - Date.now()) / 1_000)),
        );
      }
    }
    return value;
  }

  private async loadEntitlements(
    organizationId: string,
    access?: PlanTenantAccess,
    limitCacheUntil?: (timestamp: number) => void,
  ): Promise<OrganizationEntitlements> {
    const organization = await this.repository.getOrganizationEntitlements(
      organizationId,
      access,
    );
    if (!organization) throw new EntityNotFoundException('Organization');
    const subscription = organization.subscriptions?.[0];
    if (subscription) {
      const at = new Date();
      const projected = project(
        {
          status: subscription.status,
          billingInterval: subscription.billingInterval,
          billingAnchorAt: subscription.billingAnchorAt,
          currentPeriodStart: subscription.currentPeriodStart,
          currentPeriodEnd: subscription.currentPeriodEnd,
          trialEndsAt: subscription.trialEndsAt,
          graceStartsAt: subscription.graceStartsAt,
          graceEndsAt: subscription.graceEndsAt,
          providerManaged: subscription.providerSubscriptionId !== null,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          pendingEffectiveAt: subscription.pendingEffectiveAt,
        },
        at,
      );
      if (limitCacheUntil) {
        for (const boundary of [
          subscription.trialEndsAt,
          subscription.pendingEffectiveAt,
          projected.currentPeriodEnd,
          projected.graceEndsAt,
        ]) {
          if (boundary && boundary > at) limitCacheUntil(boundary.getTime());
        }
      }
      const planKey =
        projected.pendingApplied && subscription.pendingPlanCode
          ? subscription.pendingPlanCode
          : subscription.planCode;
      const plan =
        planKey === organization.plan.key
          ? organization.plan
          : await this.repository.findByKey(planKey);
      if (!plan) throw new EntityNotFoundException('Plan');
      const snapshot = (
        projected.pendingApplied
          ? subscription.pendingEntitlementsSnapshot
          : subscription.entitlementsSnapshot
      ) as {
        routeCapabilities?: unknown;
        allocation?: Prisma.JsonValue;
        usage?: Prisma.JsonValue;
      } | null;
      const contractedCapabilities = snapshot?.routeCapabilities;
      return {
        planKey,
        subscriptionStatus: projected.status,
        capabilities:
          Array.isArray(contractedCapabilities) &&
          contractedCapabilities.every((value) => typeof value === 'string')
            ? contractedCapabilities
            : plan.capabilities,
        limits:
          snapshot?.allocation && snapshot.usage
            ? {
                ...this.parseLimits(snapshot.allocation),
                ...this.parseLimits(snapshot.usage),
              }
            : this.parseLimits(plan.limits),
        currentPeriodStart: projected.currentPeriodStart,
        currentPeriodEnd: projected.currentPeriodEnd,
      };
    }
    if (organization.plan.commercial) {
      /**
       * Plano comercial sem contrato canônico não herda acesso da coluna
       * legada. Isso também fecha a janela em que o cadastro da organização
       * termina, mas o provisionamento da assinatura falha logo depois.
       */
      return {
        planKey: organization.plan.key,
        subscriptionStatus: 'PENDING_PAYMENT',
        capabilities: organization.plan.capabilities,
        limits: this.parseLimits(organization.plan.limits),
        currentPeriodStart: null,
        currentPeriodEnd: null,
      };
    }
    return {
      planKey: organization.plan.key,
      subscriptionStatus: organization.subscriptionStatus,
      capabilities: organization.plan.capabilities,
      limits: this.parseLimits(organization.plan.limits),
      currentPeriodStart: organization.currentPeriodStart,
      currentPeriodEnd: organization.currentPeriodEnd,
    };
  }

  async assertActive(
    organizationId: string,
    access?: PlanTenantAccess,
  ): Promise<void> {
    this.assertActiveOn(await this.getEntitlements(organizationId, access));
  }

  /**
   * A mesma regra, sobre permissões já resolvidas.
   *
   * Os guardas resolvem as permissões **uma vez por requisição** e passam o
   * resultado adiante — três consultas idênticas ao mesmo plano viravam três
   * transações interativas antes de o handler começar. Ver `plan-access.ts`.
   */
  assertActiveOn(entitlements: OrganizationEntitlements): void {
    if (!this.grantsAccess(entitlements)) {
      throw new SubscriptionExpiredException();
    }
  }

  /** A assinatura autoriza usar o produto agora? */
  grantsAccess(entitlements: OrganizationEntitlements): boolean {
    if (
      !SubscriptionPlanService.ALLOWED_STATUSES.has(
        entitlements.subscriptionStatus,
      )
    ) {
      return false;
    }
    if (
      entitlements.subscriptionStatus === 'PAST_DUE' ||
      entitlements.subscriptionStatus === 'GRACE_PERIOD'
    ) {
      return true;
    }
    return !(
      entitlements.currentPeriodEnd &&
      entitlements.currentPeriodEnd.getTime() <= Date.now()
    );
  }

  async assertPlan(
    organizationId: string,
    acceptedPlans: readonly string[],
    access?: PlanTenantAccess,
  ): Promise<void> {
    this.assertPlanOn(
      await this.getEntitlements(organizationId, access),
      acceptedPlans,
    );
  }

  assertPlanOn(
    entitlements: OrganizationEntitlements,
    acceptedPlans: readonly string[],
  ): void {
    if (!acceptedPlans.includes(entitlements.planKey)) {
      throw new ForbiddenException(
        'The current plan does not allow this action',
      );
    }
  }

  async assertCapabilities(
    organizationId: string,
    required: readonly string[],
    access?: PlanTenantAccess,
  ): Promise<void> {
    this.assertCapabilitiesOn(
      await this.getEntitlements(organizationId, access),
      required,
    );
  }

  assertCapabilitiesOn(
    entitlements: OrganizationEntitlements,
    required: readonly string[],
  ): void {
    const granted = new Set(entitlements.capabilities);
    if (
      !granted.has('*') &&
      !required.every((capability) => granted.has(capability))
    ) {
      throw new ForbiddenException(
        'The current plan does not include the required capability',
      );
    }
  }

  private parseLimits(
    value: Prisma.JsonValue,
  ): Readonly<Record<string, number | null>> {
    if (!value || Array.isArray(value) || typeof value !== 'object') return {};
    return Object.entries(value).reduce<Record<string, number | null>>(
      (limits, [resource, limit]) => {
        if (limit === null) limits[resource] = null;
        if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 0) {
          limits[resource] = limit;
        }
        return limits;
      },
      {},
    );
  }

  private validateLimits(
    limits: Record<string, number | null> | undefined,
  ): void {
    if (!limits) return;
    for (const [resource, limit] of Object.entries(limits)) {
      if (
        resource.trim().length === 0 ||
        (limit !== null &&
          (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0))
      ) {
        throw new ValidationException('Plan limits are invalid');
      }
    }
  }
}
