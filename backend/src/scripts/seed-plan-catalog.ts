import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { generateUuidV7 } from '../utils';
import { snapshotOf } from '../modules/subscription-plans/subscriptions/subscription.snapshot';
import { PLAN_CATALOG } from '../modules/subscription-plans/catalog/plan-registry';
import {
  BillingInterval,
  PlanCapability,
  PlanCode,
} from '../modules/subscription-plans/catalog/plan-catalog.types';

config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), '../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('Required environment variable DATABASE_URL is missing');
}

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

/**
 * As permissões da camada de inteligência.
 *
 * São elas que o `CapabilityGuard` recusa nos planos sem inteligência — o
 * portão do produto, em `EntitlementService`, é o segundo. Dois portões
 * concordando é o desenho: capacidade responde "a empresa comprou?", permissão
 * responde "esta pessoa pode?", e a IA precisa das duas respostas.
 */
const PERMISSOES_DE_INTELIGENCIA = [
  'ai.agents.manage',
  'ai.agents.read',
  'ai.executions.read',
  'ai.executions.run',
  'scheduling.intelligence',
];

/** Toda a superfície operacional do produto, sem a camada de inteligência. */
const PERMISSOES_OPERACIONAIS = [
  'analytics.read',
  'artifact_executions.execute',
  'artifact_executions.manage',
  'artifact_executions.read',
  'artifact_manifests.manage',
  'artifact_manifests.read',
  'artifact_rendering.render',
  'artifact_templates.manage',
  'artifact_templates.read',
  'assets.manage',
  'assets.qr.manage',
  'assets.read',
  'automations.manage',
  'automations.read',
  'business_units.manage',
  'business_units.read',
  'catalog.manage',
  'catalog.read',
  'checklists.execute',
  'checklists.manage',
  'checklists.read',
  'crm.manage',
  'crm.read',
  'customer_service_requests.manage',
  'customer_service_requests.read',
  'dashboard.read',
  'document_engine.manage',
  'document_engine.read',
  'financial.manage',
  'financial.read',
  'integrations.manage',
  'integrations.read',
  'inventory.manage',
  'inventory.read',
  'notifications.manage',
  'notifications.read',
  'operations.manage',
  'operations.read',
  'pmoc.manage',
  'pmoc.read',
  'quotes.manage',
  'quotes.read',
  'reports.management.manage',
  'reports.management.read',
  'reports.manage',
  'reports.read',
  'reports.render',
  'rvt.document',
  'rvt.execute',
  'rvt.manage',
  'rvt.read',
  'scheduling.manage',
  'scheduling.read',
  'signatures.manage',
  'signatures.read',
  'workforce.manage',
  'workforce.read',
];

function permissoes(capabilities: readonly string[]): string[] {
  const comInteligencia = capabilities.includes(
    PlanCapability.ORBIT_INTELLIGENCE,
  );
  return [
    ...PERMISSOES_OPERACIONAIS,
    ...(comInteligencia ? PERMISSOES_DE_INTELIGENCIA : []),
  ].sort();
}

async function seed(): Promise<void> {
  const resumo = { criados: 0, atualizados: 0 };

  for (const plano of PLAN_CATALOG) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.plan.findUnique({ where: { key: plano.code } });
      if (existing?.commercial) return;
      const prices = Object.fromEntries(
        Object.values(BillingInterval).map((interval) => {
          const stripePriceId =
            process.env[`STRIPE_PRICE_${plano.code}_${interval}`]?.trim();
          if (stripePriceId && !/^price_[A-Za-z0-9_]+$/.test(stripePriceId))
            throw new Error(
              `Invalid legacy Stripe Price for ${plano.code}/${interval}`,
            );
          return [
            interval,
            {
              ...plano.prices[interval]!,
              ...(stripePriceId ? { stripePriceId } : {}),
            },
          ];
        }),
      );
      const data = {
        name: existing?.name ?? plano.label,
        description: existing?.description ?? plano.description,
        monthlyPrice: (plano.prices.MONTHLY!.amountMinor / 100).toFixed(2),
        annualPrice: (plano.prices.ANNUAL!.amountMinor / 100).toFixed(2),
        currency: 'BRL',
        capabilities: permissoes(plano.capabilities),
        isActive: existing?.isActive ?? true,
        commercial: {
          trialDays: plano.code === PlanCode.ESSENTIAL ? 30 : 0,
          prices,
          entitlements: snapshotOf(plano),
        } as unknown as Prisma.InputJsonValue,
      };
      await tx.plan.upsert({
        where: { key: plano.code },
        create: { id: generateUuidV7(), key: plano.code, ...data },
        update: data,
      });
      for (const interval of Object.values(BillingInterval)) {
        const price = prices[interval]!;
        if (price.stripePriceId) {
          await tx.planStripePrice.create({
            data: {
              id: price.stripePriceId,
              planCode: plano.code,
              billingInterval: interval,
              amountMinor: price.amountMinor,
            },
          });
        }
      }
      if (existing) resumo.atualizados++;
      else resumo.criados++;
    });
  }

  console.log(
    `[plan-catalog] ${resumo.criados} plano(s) criado(s), ` +
      `${resumo.atualizados} atualizado(s). Nenhuma organização foi movida.`,
  );
}

seed()
  .catch((error: unknown) => {
    console.error('[plan-catalog] falha na semeadura:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
