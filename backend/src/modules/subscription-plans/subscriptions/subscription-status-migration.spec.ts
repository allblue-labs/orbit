import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SubscriptionStatus } from './subscription.types';

it('keeps the persisted subscription statuses aligned with the domain', () => {
  const migrations = resolve(__dirname, '../../../../prisma/migrations');
  let values: string[] | undefined;
  for (const directory of readdirSync(migrations).sort()) {
    if (!/^\d/.test(directory)) continue;
    const sql = readFileSync(
      resolve(migrations, directory, 'migration.sql'),
      'utf8',
    );
    const constraint =
      /ADD CONSTRAINT "organization_subscriptions_status_valid" CHECK\s*\(\s*"status" IN\s*\(([^)]+)\)/.exec(
        sql,
      );
    if (constraint)
      values = [...constraint[1]!.matchAll(/'([A-Z_]+)'/g)].map(
        (match) => match[1]!,
      );
  }
  expect(values?.sort()).toEqual(Object.values(SubscriptionStatus).sort());
});
