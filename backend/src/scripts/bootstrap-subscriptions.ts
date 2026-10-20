/**
 * Dá assinatura às organizações que existiam antes da PR-PL-02.
 *
 * ## O que ele faz, e o que recusa fazer
 *
 * Cria **uma** assinatura ativa espelhando o plano que a organização já tem, e
 * nada além disso:
 *
 * - **nenhuma avaliação retroativa.** Quem já é cliente não ganha trinta dias
 *   grátis por causa de uma migração, e o registro antifraude não é semeado
 *   com documentos de quem nunca pediu avaliação;
 * - **nenhuma troca de plano.** A organização continua exatamente no plano em
 *   que estava;
 * - **nenhum contrato para fixture.** Plano fora do catálogo comercial —
 *   `STARTER`, `OWNER_FULL_ACCESS`, planos de teste — não vira assinatura: ele
 *   continua resolvendo pelo caminho legado, que é o que já era. Inventar um
 *   contrato comercial para um inquilino interno faria a plataforma cobrar de
 *   si mesma.
 *
 * A âncora é a data que a organização já tinha. Assim a janela de uso da
 * assinatura nasce igual à que a PR-PL-01 já usava, e nenhuma cota é zerada ou
 * duplicada pela migração.
 *
 * Idempotente: rodar de novo não cria segunda assinatura.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { generateUuidV7 } from '../utils';
import {
  BILLING_INTERVAL_MONTHS,
  BillingInterval,
  CATALOG_VERSION,
} from '../modules/subscription-plans/catalog/plan-catalog.types';
import {
  isKnownPlan,
  planDefinition,
} from '../modules/subscription-plans/catalog/plan-registry';
import { anchoredPeriod } from '../modules/subscription-plans/entitlements/anchored-period';
import { snapshotOf } from '../modules/subscription-plans/subscriptions/subscription.snapshot';

config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), '../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('Required environment variable DATABASE_URL is missing');
}

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

async function bootstrap(): Promise<void> {
  const resumo = { criadas: 0, jaTinham: 0, foraDoCatalogo: 0 };

  const organizacoes = await prisma.organization.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      createdAt: true,
      subscriptionStartedAt: true,
      currentPeriodStart: true,
      plan: { select: { key: true } },
      subscriptions: { where: { endedAt: null }, select: { id: true } },
    },
  });

  for (const organizacao of organizacoes) {
    if (organizacao.subscriptions.length > 0) {
      resumo.jaTinham += 1;
      continue;
    }
    if (!isKnownPlan(organizacao.plan.key)) {
      resumo.foraDoCatalogo += 1;
      continue;
    }

    const plano = planDefinition(organizacao.plan.key);
    const ancora =
      organizacao.subscriptionStartedAt ??
      organizacao.currentPeriodStart ??
      organizacao.createdAt;
    const periodo = anchoredPeriod(
      ancora,
      BILLING_INTERVAL_MONTHS[BillingInterval.MONTHLY]!,
      new Date(),
    );

    await prisma.organizationSubscription.create({
      data: {
        id: generateUuidV7(),
        organizationId: organizacao.id,
        planCode: plano.code,
        catalogVersion: CATALOG_VERSION,
        entitlementsSnapshot: snapshotOf(plano) as never,
        billingInterval: BillingInterval.MONTHLY,
        status: 'ACTIVE',
        billingAnchorAt: ancora,
        currentPeriodStart: periodo.start,
        currentPeriodEnd: periodo.end,
        startedAt: ancora,
      },
    });
    resumo.criadas += 1;
  }

  console.log(
    `[subscriptions] ${resumo.criadas} assinatura(s) criada(s), ` +
      `${resumo.jaTinham} já existiam, ` +
      `${resumo.foraDoCatalogo} organização(ões) fora do catálogo comercial ` +
      `mantida(s) no caminho legado. Nenhuma avaliação retroativa concedida.`,
  );
}

bootstrap()
  .catch((error: unknown) => {
    console.error('[subscriptions] falha no bootstrap:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
