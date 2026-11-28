import { directDatabaseUrl } from './direct-database-url';
import { Client } from 'pg';
import {
  scopeRules,
  violationSql,
} from '../database/relational-integrity/contract';

/** Read-only, all-tenant preflight. Does not load developer dotenv automatically. */
async function main() {
  const client = new Client({
    connectionString: directDatabaseUrl(),
    application_name: 'orbit-relational-preflight',
  });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query('SET LOCAL row_security=off');
    const runtime = await client.query<{ allowed: boolean }>(
      'SELECT rolsuper OR rolbypassrls AS allowed FROM pg_roles WHERE rolname=current_user',
    );
    if (!runtime.rows[0]?.allowed)
      throw new Error('Administrative visibility required');
    const findings: { rule: string; violations: string }[] = [];
    for (const rule of scopeRules) {
      const result = await client.query<{ violations: string }>(
        violationSql(rule),
      );
      if (result.rows[0]!.violations !== '0')
        findings.push({
          rule: rule.name,
          violations: result.rows[0]!.violations,
        });
    }
    await client.query('ROLLBACK');
    console.log(
      JSON.stringify(
        {
          stage: 'relational-integrity-preflight',
          rules: scopeRules.length,
          findings,
        },
        null,
        2,
      ),
    );
    if (findings.length) process.exitCode = 2;
  } finally {
    await client.end();
  }
}
void main().catch(() => {
  console.error(
    'Relational preflight unavailable: administrative visibility, schema and connection are required. No data changed.',
  );
  process.exitCode = 1;
});
