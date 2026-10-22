/** Targeted recovery after organization creation succeeded but provisioning failed. */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { generateUuidV7 } from '../utils';
import {
  BillingInterval,
  BILLING_INTERVAL_MONTHS,
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

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

async function main() {
  const id = option('--organization-id');
  const email = option('--owner-email')?.trim().toLowerCase();
  const interval = option('--billing-interval') ?? BillingInterval.MONTHLY;
  const apply = process.argv.includes('--apply');
  if ((!id && !email) || !Object.values(BillingInterval).includes(interval)) {
    throw new Error(
      'Use --organization-id UUID ou --owner-email EMAIL, opcionalmente --billing-interval MONTHLY|SEMIANNUAL|ANNUAL e --apply. Sem --apply, somente consulta.',
    );
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL é obrigatória.');
  const prisma = new PrismaClient({
    adapter: new PrismaPg(process.env.DATABASE_URL),
  });
  try {
    await prisma.$transaction(async (tx) => {
      const organizations = await tx.organization.findMany({
        where: {
          deletedAt: null,
          ...(id ? { id } : {}),
          ...(email ? { owner: { normalizedEmail: email } } : {}),
        },
        select: {
          id: true,
          status: true,
          subscriptionStatus: true,
          externalCustomerId: true,
          externalSubscriptionId: true,
          plan: { select: { key: true } },
        },
        take: 2,
      });
      if (organizations.length !== 1)
        throw new Error(
          'A consulta deve identificar exatamente uma organização. Use --organization-id para desambiguar.',
        );
      const organization = organizations[0]!;
      if (apply)
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organization.id}::uuid FOR UPDATE`;
      const current = await tx.organizationSubscription.findFirst({
        where: { organizationId: organization.id, endedAt: null },
        select: { id: true },
      });
      if (current) {
        console.log(
          'A organização já possui assinatura corrente. Nenhuma alteração realizada.',
        );
        return;
      }
      if (
        !isKnownPlan(organization.plan.key) ||
        organization.status !== 'ACTIVE' ||
        organization.subscriptionStatus !== 'TRIALING'
      ) {
        throw new Error(
          'A organização não corresponde ao estado de um cadastro comercial incompleto.',
        );
      }
      const customer = await tx.billingCustomer.count({
        where: { organizationId: organization.id },
      });
      const trial = await tx.subscriptionTrialGrant.count({
        where: { organizationId: organization.id },
      });
      if (
        organization.externalCustomerId ||
        organization.externalSubscriptionId ||
        customer > 0 ||
        trial > 0
      ) {
        throw new Error(
          'Já existe vínculo de cobrança ou avaliação. É necessária análise específica; o reparo foi recusado.',
        );
      }
      console.log(
        JSON.stringify({
          organizationId: organization.id,
          planCode: organization.plan.key,
          billingInterval: interval,
          status: 'PENDING_PAYMENT',
          apply,
        }),
      );
      if (!apply) return;
      const start = new Date();
      const period = anchoredPeriod(
        start,
        BILLING_INTERVAL_MONTHS[interval] ?? 1,
        start,
      );
      await tx.organizationSubscription.create({
        data: {
          id: generateUuidV7(),
          organizationId: organization.id,
          planCode: organization.plan.key,
          catalogVersion: CATALOG_VERSION,
          entitlementsSnapshot: snapshotOf(
            planDefinition(organization.plan.key),
          ) as unknown as Prisma.InputJsonValue,
          billingInterval: interval,
          status: 'PENDING_PAYMENT',
          billingAnchorAt: start,
          currentPeriodStart: period.start,
          currentPeriodEnd: period.end,
          startedAt: start,
        },
      });
      console.log(
        'Assinatura pendente criada. Nenhum pagamento foi realizado ou acesso pago ativado.',
      );
    });
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error && error.constructor === Error
      ? error.message
      : 'Reparo recusado ou falha no banco. Nenhum detalhe de cadastro foi registrado.',
  );
  process.exitCode = 1;
});
