import { Injectable, Optional } from '@nestjs/common';
import { Prisma, type Plan } from '@prisma/client';
import { RequestContextService } from '../../../context';
import { PrismaService, RlsTransaction } from '../../../database';
import type { PrismaTransactionClient } from '../../../database/prisma.types';
import { ConflictException, ValidationException } from '../../../exceptions';
import {
  AllocationResource,
  BillingInterval,
  PlanCapability,
  UsageResource,
  limited,
  UNLIMITED,
  type PlanDefinition,
} from './plan-catalog.types';

interface CommercialPrice {
  amountMinor: number;
  listAmountMinor?: number;
  stripePriceId?: string;
}

interface CommercialData {
  trialDays: number;
  promotion?: string;
  prices: Record<BillingInterval, CommercialPrice>;
  entitlements: {
    capabilities: PlanCapability[];
    allocation: Record<AllocationResource, number | null>;
    usage: Record<UsageResource, number | null>;
  };
}

export interface CommercialPlan extends PlanDefinition {
  version: number;
  routeCapabilities: readonly string[];
  isActive: boolean;
  tenantId: string | null;
  trialDays: number;
  promotion: string | null;
  prices: Record<BillingInterval, CommercialPrice & { currency: 'BRL' }>;
}

/** A published offer is replaced atomically. Stripe Price IDs remain immutable and recognizable. */
@Injectable()
export class CommercialPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
    @Optional() private readonly contexts?: RequestContextService,
  ) {}

  async list(tenantId?: string) {
    return (await this.offerRows(tenantId)).map((plan) =>
      this.toDefinition(plan),
    );
  }

  async catalogEntries(
    tenantId?: string,
    identifier?: { id: string } | { key: string },
  ) {
    return (await this.offerRows(tenantId, identifier)).map((plan) => ({
      id: plan.id,
      offer: this.toDefinition(plan),
    }));
  }

  private offerRows(
    tenantId?: string,
    identifier?: { id: string } | { key: string },
  ) {
    return this.read((tx) =>
      tx.plan.findMany({
        where: {
          ...identifier,
          commercial: { not: Prisma.DbNull },
          OR: [
            { catalogTenantId: null },
            ...(tenantId ? [{ catalogTenantId: tenantId }] : []),
          ],
        },
        orderBy: [{ monthlyPrice: 'asc' }, { key: 'asc' }],
      }),
    );
  }

  async find(code: string, tx?: Pick<Prisma.TransactionClient, 'plan'>) {
    const find = (client: Pick<Prisma.TransactionClient, 'plan'>) =>
      client.plan.findUnique({ where: { key: code } });
    const plan = await (tx ? find(tx) : this.read(find));
    return plan?.commercial ? this.toDefinition(plan) : null;
  }

  async require(code: string, tx?: Prisma.TransactionClient) {
    const plan = await this.find(code, tx);
    if (!plan) throw new ValidationException('Plano comercial inválido.');
    return plan;
  }

  async selectable(
    code: string,
    tenantId?: string,
    tx?: Prisma.TransactionClient,
  ) {
    const plan = await this.require(code, tx);
    if (
      !plan.isActive ||
      (plan.tenantId !== null && plan.tenantId !== tenantId)
    )
      throw new ValidationException(
        'Este plano não está disponível para contratação.',
      );
    return plan;
  }

  stripePrice(id: string) {
    return this.read((tx) => tx.planStripePrice.findUnique({ where: { id } }));
  }

  private read<T>(query: (tx: PrismaTransactionClient) => Promise<T>) {
    return this.contexts?.getOptional()
      ? this.rls.run(query)
      : query(this.prisma);
  }

  adminList() {
    return this.rls.run((tx) =>
      tx.plan.findMany({
        where: { commercial: { not: Prisma.DbNull } },
        orderBy: { key: 'asc' },
        select: {
          key: true,
          name: true,
          description: true,
          isActive: true,
          catalogVersion: true,
          catalogTenantId: true,
          commercial: true,
          capabilities: true,
        },
      }),
    );
  }

  async publish(
    code: string,
    input: {
      expectedVersion: number;
      name: string;
      description: string;
      isActive: boolean;
      tenantId?: string;
      permissions: string[];
      offer: unknown;
    },
    actorId: string,
    validatePrices?: (prices: CommercialData['prices']) => Promise<void>,
  ) {
    const commercial = this.validate(input.offer);
    await validatePrices?.(commercial.prices);
    if (
      new Set(input.permissions).size !== input.permissions.length ||
      input.permissions.some(
        (permission) =>
          !/^[a-z][a-z_]*(?:\.[a-z][a-z_]*)+$/.test(permission) ||
          permission.startsWith('platform.'),
      )
    )
      throw new ValidationException('Capacidades de acesso inválidas.');
    return this.rls.run(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'plan:' + code},0))::text`;
      const existing = await tx.plan.findUnique({ where: { key: code } });
      if (existing && !existing.commercial)
        throw new ConflictException(
          'Este código pertence a um plano legado. Escolha um novo código.',
          'CONFLICT',
        );
      const version = existing?.commercial ? existing.catalogVersion : 0;
      if (input.expectedVersion !== version)
        throw new ConflictException(
          'O plano foi alterado. Atualize antes de salvar.',
          'STALE_VERSION',
        );
      const catalogTenantId = input.tenantId ?? null;
      if (existing?.commercial && existing.catalogTenantId !== catalogTenantId)
        throw new ValidationException(
          'A organização vinculada a um plano publicado é permanente.',
        );
      if (
        catalogTenantId &&
        !(await tx.organization.findFirst({
          where: { id: catalogTenantId, deletedAt: null },
          select: { id: true },
        }))
      )
        throw new ValidationException('Organização do plano inválida.');
      const data = {
        name: input.name.trim(),
        description: input.description.trim(),
        isActive: input.isActive,
        catalogVersion: version + 1,
        catalogTenantId,
        commercial: commercial as unknown as Prisma.InputJsonValue,
        monthlyPrice: (commercial.prices.MONTHLY!.amountMinor / 100).toFixed(2),
        annualPrice: (commercial.prices.ANNUAL!.amountMinor / 100).toFixed(2),
        currency: 'BRL',
        capabilities: input.permissions,
      };
      const plan = await tx.plan.upsert({
        where: { key: code },
        create: { key: code, ...data },
        update: data,
      });
      for (const interval of Object.values(BillingInterval)) {
        const price = commercial.prices[interval]!;
        if (!price.stripePriceId) continue;
        const mapping = await tx.planStripePrice.upsert({
          where: { id: price.stripePriceId },
          create: {
            id: price.stripePriceId,
            planCode: code,
            billingInterval: interval,
            amountMinor: price.amountMinor,
          },
          update: {},
        });
        if (
          mapping.planCode !== code ||
          mapping.billingInterval !== interval ||
          mapping.amountMinor !== price.amountMinor
        )
          throw new ValidationException(
            'Use um novo ID de preço do Stripe para o novo valor ou periodicidade.',
          );
      }
      await tx.auditLog.create({
        data: {
          organizationId: catalogTenantId,
          userId: actorId,
          action: 'COMMERCIAL_PLAN_PUBLISHED',
          entityType: 'PLAN',
          entityId: plan.id,
          metadata: { code, version: plan.catalogVersion },
        },
      });
      return this.toDefinition(plan);
    });
  }

  private validate(input: unknown): CommercialData {
    const data = input as Partial<CommercialData> | null;
    const invalid = () =>
      new ValidationException(
        'Confira os preços, a avaliação e todos os limites do plano.',
      );
    if (
      !data ||
      !Number.isInteger(data.trialDays) ||
      data.trialDays! < 0 ||
      data.trialDays! > 730 ||
      (data.promotion !== undefined &&
        (typeof data.promotion !== 'string' || data.promotion.length > 180)) ||
      !data.prices ||
      !data.entitlements ||
      !Array.isArray(data.entitlements.capabilities) ||
      new Set(data.entitlements.capabilities).size !==
        data.entitlements.capabilities.length ||
      data.entitlements.capabilities.some(
        (key) => !Object.values(PlanCapability).includes(key),
      )
    )
      throw invalid();
    const validInt = (value: unknown): value is number =>
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 2_147_483_647;
    const prices = {} as CommercialData['prices'];
    for (const interval of Object.values(BillingInterval)) {
      const price = data.prices[interval];
      if (
        !price ||
        !validInt(price.amountMinor) ||
        (price.listAmountMinor !== undefined &&
          (!validInt(price.listAmountMinor) ||
            price.listAmountMinor <= price.amountMinor)) ||
        (price.stripePriceId !== undefined &&
          (typeof price.stripePriceId !== 'string' ||
            !/^price_[A-Za-z0-9_]{1,230}$/.test(price.stripePriceId)))
      )
        throw invalid();
      prices[interval] = {
        amountMinor: price.amountMinor,
        ...(price.listAmountMinor === undefined
          ? {}
          : { listAmountMinor: price.listAmountMinor }),
        ...(price.stripePriceId === undefined
          ? {}
          : { stripePriceId: price.stripePriceId }),
      };
    }
    const limits = <T extends string>(
      keys: readonly T[],
      values: Record<T, unknown>,
    ) =>
      Object.fromEntries(
        keys.map((key) => {
          const value = values?.[key];
          if (value !== null && !validInt(value)) throw invalid();
          return [key, value];
        }),
      ) as Record<T, number | null>;
    return {
      trialDays: data.trialDays!,
      ...(data.promotion?.trim() ? { promotion: data.promotion.trim() } : {}),
      prices,
      entitlements: {
        capabilities: data.entitlements.capabilities,
        allocation: limits(
          Object.values(AllocationResource),
          data.entitlements.allocation,
        ),
        usage: limits(Object.values(UsageResource), data.entitlements.usage),
      },
    };
  }

  private toDefinition(plan: Plan): CommercialPlan {
    const data = this.validate(plan.commercial);
    const limits = <T extends string>(values: Record<T, number | null>) =>
      Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          value === null ? UNLIMITED : limited(value as number),
        ]),
      ) as Record<T, ReturnType<typeof limited>>;
    return {
      code: plan.key,
      label: plan.name,
      description: plan.description ?? '',
      prices: Object.fromEntries(
        Object.entries(data.prices).map(([key, price]) => [
          key,
          { ...price, currency: 'BRL' as const },
        ]),
      ),
      capabilities: data.entitlements.capabilities,
      allocation: limits(data.entitlements.allocation),
      usage: limits(data.entitlements.usage),
      version: plan.catalogVersion,
      routeCapabilities: plan.capabilities,
      isActive: plan.isActive,
      tenantId: plan.catalogTenantId,
      trialDays: data.trialDays,
      promotion: data.promotion ?? null,
    };
  }
}
