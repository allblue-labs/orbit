import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrationSql } from '../src/database/relational-integrity/contract';
writeFileSync(
  resolve(
    __dirname,
    '../prisma/migrations/20261117100000_relational_tenant_integrity/migration.sql',
  ),
  migrationSql(),
);
