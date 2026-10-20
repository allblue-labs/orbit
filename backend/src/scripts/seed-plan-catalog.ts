/**
 * Semeadura dos quatro planos comerciais.
 *
 * O catálogo que decide acesso vive em código (`catalog/plan-catalog.ts`) e é
 * ele a autoridade. Estas linhas em `plans` existem por outro motivo: é a elas
 * que `organizations.plan_id` aponta, e é delas que o `CapabilityGuard` lê as
 * **permissões** da organização. Duas coisas diferentes com o mesmo nome
 * histórico — ver `backend/docs/plans-entitlements-usage.md`.
 *
 * ## Por que um script, e não uma migração
 *
 * Preço e rótulo mudam por decisão comercial; migração aplicada não se
 * corrige. O script é idempotente e reconcilia por `key`, que é o código
 * estável do plano — nunca por identificador gerado (§108, §109).
 *
 * ## O que este script não faz
 *
 * Não move ninguém de plano. Nenhuma organização existente é reatribuída,
 * porque decidir que todo mundo passa a ser Essencial mudaria os tetos de
 * inquilinos que nunca tiveram teto (§106). Migrar inquilino é decisão de
 * produto, e terá a sua própria PR.
 *
 * `limits` fica vazio de propósito: o teto é do catálogo em código, e uma
 * segunda cópia editável no banco só serviria para as duas divergirem (§130).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { generateUuidV7 } from '../utils';
import { PLAN_CATALOG } from '../modules/subscription-plans/catalog/plan-registry';
import {
  BillingInterval,
  PlanCapability,
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
    const existente = await prisma.plan.findUnique({
      where: { key: plano.code },
      select: { id: true },
    });
    const dados = {
      name: plano.label,
      description: plano.description,
      monthlyPrice: (
        plano.prices[BillingInterval.MONTHLY]!.amountMinor / 100
      ).toFixed(2),
      currency: 'BRL',
      capabilities: permissoes(plano.capabilities),
      isActive: true,
    };
    if (existente) {
      await prisma.plan.update({ where: { id: existente.id }, data: dados });
      resumo.atualizados += 1;
      continue;
    }
    await prisma.plan.create({
      data: { id: generateUuidV7(), key: plano.code, limits: {}, ...dados },
    });
    resumo.criados += 1;
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
