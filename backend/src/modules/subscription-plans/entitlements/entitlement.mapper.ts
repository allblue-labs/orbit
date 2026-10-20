/**
 * Do catálogo e do estado para o que a API publica.
 *
 * `UNLIMITED` sai como `{ unlimited: true, value: null }` — nunca como um
 * número grande. O cliente que ler `value` de um plano ilimitado encontra
 * `null` e é obrigado a tratar o caso; um `999999` seria comparado como número
 * algum dia, e viraria teto sem que ninguém tivesse decidido isso (§37).
 */
import { Injectable } from '@nestjs/common';
import type {
  OrganizationEntitlementsReadModel,
  PlanCatalogEntryReadModel,
  PlanCatalogReadModel,
  PlanLimitReadModel,
  ResourceEntitlementReadModel,
} from '../subscription-plan.read-models';
import {
  AllocationResource,
  BillingInterval,
  UsageResource,
  type PlanDefinition,
  type PlanLimit,
} from '../catalog/plan-catalog.types';
import { PLAN_CATALOG } from '../catalog/plan-registry';
import type { EffectiveEntitlements } from './effective-entitlements';
import type { UsageWindow } from './usage-window';

/** Centavos para o texto que a página mostra. Nunca ponto flutuante. */
function reais(amountMinor: number): string {
  const inteiro = Math.trunc(amountMinor / 100);
  const centavos = String(amountMinor % 100).padStart(2, '0');
  return `${inteiro}.${centavos}`;
}

@Injectable()
export class EntitlementMapper {
  catalog(): PlanCatalogReadModel {
    return { plans: PLAN_CATALOG.map((plan) => this.plan(plan)) };
  }

  entitlements(
    direitos: EffectiveEntitlements,
    window: UsageWindow,
    alocacao: readonly ResourceEntitlementReadModel[],
    uso: readonly ResourceEntitlementReadModel[],
  ): OrganizationEntitlementsReadModel {
    return {
      planCode: direitos.planCode,
      label: direitos.label,
      source: direitos.source,
      capabilities: [...direitos.capabilities].sort(),
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString(),
      },
      allocation: alocacao,
      usage: uso,
    };
  }

  resource(
    resource: string,
    limit: PlanLimit,
    current: number,
  ): ResourceEntitlementReadModel {
    return {
      resource,
      current,
      limit: this.limit(limit),
      remaining:
        limit.kind === 'UNLIMITED' ? null : Math.max(0, limit.value - current),
    };
  }

  private plan(plan: PlanDefinition): PlanCatalogEntryReadModel {
    return {
      code: plan.code,
      label: plan.label,
      description: plan.description,
      monthlyPrice: reais(plan.prices[BillingInterval.MONTHLY]!.amountMinor),
      currency: 'BRL',
      prices: Object.fromEntries(
        Object.entries(plan.prices).map(([intervalo, preco]) => [
          intervalo,
          {
            amountMinor: preco.amountMinor,
            currency: preco.currency,
            formatted: reais(preco.amountMinor),
          },
        ]),
      ),
      capabilities: [...plan.capabilities],
      allocation: this.limits(AllocationResource, plan.allocation),
      usage: this.limits(UsageResource, plan.usage),
    };
  }

  private limits<T extends string>(
    recursos: Record<string, T>,
    limites: Readonly<Record<T, PlanLimit>>,
  ): Record<string, PlanLimitReadModel> {
    return Object.values(recursos).reduce<Record<string, PlanLimitReadModel>>(
      (mapa, recurso) => {
        mapa[recurso] = this.limit(limites[recurso]);
        return mapa;
      },
      {},
    );
  }

  private limit(limit: PlanLimit): PlanLimitReadModel {
    return limit.kind === 'UNLIMITED'
      ? { unlimited: true, value: null }
      : { unlimited: false, value: limit.value };
  }
}
