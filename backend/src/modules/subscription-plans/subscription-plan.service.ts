import { Injectable } from '@nestjs/common';
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
import { isKnownPlan } from './catalog/plan-registry';

export interface OrganizationEntitlements {
  planKey: string;
  subscriptionStatus: string;
  capabilities: readonly string[];
  limits: Readonly<Record<string, number | null>>;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

@Injectable()
export class SubscriptionPlanService {
  private static readonly ALLOWED_STATUSES = new Set([
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'GRACE_PERIOD',
  ]);

  constructor(private readonly repository: SubscriptionPlanRepository) {}

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
  ): Promise<OrganizationEntitlements> {
    const organization = await this.repository.getOrganizationEntitlements(
      organizationId,
      access,
    );
    if (!organization) throw new EntityNotFoundException('Organization');
    const subscription = organization.subscriptions?.[0];
    if (subscription) {
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
        new Date(),
      );
      const planKey =
        projected.pendingApplied && subscription.pendingPlanCode
          ? subscription.pendingPlanCode
          : subscription.planCode;
      const plan =
        planKey === organization.plan.key
          ? organization.plan
          : await this.repository.findActiveByKey(planKey);
      if (!plan) throw new EntityNotFoundException('Plan');
      return {
        planKey,
        subscriptionStatus: projected.status,
        capabilities: plan.capabilities,
        limits: this.parseLimits(plan.limits),
        currentPeriodStart: projected.currentPeriodStart,
        currentPeriodEnd: projected.currentPeriodEnd,
      };
    }
    if (isKnownPlan(organization.plan.key)) {
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
