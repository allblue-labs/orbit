import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import {
  BillingInterval,
  PlanCode,
} from '../modules/subscription-plans/catalog/plan-catalog.types';

config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), '../.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('Required environment variable DATABASE_URL is missing');
}

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });
const bootstrapFlag = '_bootstrapStripePrices';

/** Commercial defaults are installed by Prisma migrations. Only provider IDs vary by environment. */
async function importBootstrapPrices(): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;
    let imported = 0;
    for (const code of Object.values(PlanCode).sort()) {
      // Serialize with the same lock used when a platform administrator publishes an offer.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'plan:' + code}, 0))::text`;
      const plan = await tx.plan.findUnique({ where: { key: code } });
      if (plan?.catalogVersion !== 1 || plan.catalogTenantId !== null) continue;

      const commercial = plan.commercial as Prisma.JsonObject | null;
      if (commercial?.[bootstrapFlag] !== true) continue;
      const prices = commercial.prices as Record<
        BillingInterval,
        { amountMinor: number; stripePriceId?: string }
      >;
      for (const interval of Object.values(BillingInterval)) {
        const stripePriceId =
          process.env[`STRIPE_PRICE_${code}_${interval}`]?.trim();
        if (!stripePriceId) continue;
        const price = prices[interval];
        if (!price || !Number.isSafeInteger(price.amountMinor))
          throw new Error(`Missing catalog price for ${code}/${interval}`);
        if (price.stripePriceId) continue;
        if (!/^price_[A-Za-z0-9_]{1,230}$/.test(stripePriceId))
          throw new Error(`Invalid Stripe Price ID for ${code}/${interval}`);

        const mapping = await tx.planStripePrice.upsert({
          where: { id: stripePriceId },
          create: {
            id: stripePriceId,
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
          throw new Error(
            `Stripe Price ID already mapped to a different offer: ${code}/${interval}`,
          );
        price.stripePriceId = stripePriceId;
        imported++;
      }

      // Once consumed, deploys no longer read environment IDs for this plan.
      delete commercial[bootstrapFlag];
      await tx.plan.update({
        where: { id: plan.id },
        data: { commercial },
      });
    }
    return imported;
  });
}

importBootstrapPrices()
  .then((imported) => {
    console.log(
      `[plan-catalog] ${imported} vínculo(s) Stripe inicial(is) importado(s).`,
    );
  })
  .catch((error: unknown) => {
    console.error('[plan-catalog] falha ao importar vínculos Stripe:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
