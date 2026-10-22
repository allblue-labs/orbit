import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { InfrastructureException } from '../exceptions';
import { BillingConfig } from '../modules/billing/billing.config';
import { StripeBillingProvider } from '../modules/billing/stripe/stripe-billing.provider';

loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '../.env'), quiet: true });
Logger.overrideLogger(false);

async function main(): Promise<void> {
  const enabled = process.env.STRIPE_ENABLED?.trim() === 'true';
  console.log(`STRIPE_ENABLED: ${enabled}`);
  // Validate the prepared configuration even while billing is disabled.
  const config = new BillingConfig({
    get: (key: string) => process.env[key] ?? '',
    getOptional: (key: string) =>
      key === 'STRIPE_ENABLED' ? 'true' : process.env[key],
  });
  console.log(`Configuração local válida. Modo: ${config.mode}. Preços: 12.`);
  if (!process.argv.includes('--remote')) {
    console.log(
      'Para conferir os preços no Stripe, execute novamente com --remote. A conferência remota faz somente leituras.',
    );
    return;
  }
  const results = await new StripeBillingProvider(config).verifyPriceCatalog();
  for (const result of results) {
    console.log(
      `${result.planCode}/${result.billingInterval}: ${result.valid ? 'OK' : result.problem}`,
    );
  }
  if (results.some((result) => !result.valid)) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  // Configuration errors are written by us using variable names only.
  console.error(
    error instanceof InfrastructureException
      ? error.message
      : 'Não foi possível concluir a conferência do Stripe.',
  );
  process.exitCode = 1;
});
