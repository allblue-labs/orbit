import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Customer Portal migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260906120000_pr32_customer_portal_identity_boundary/migration.sql',
    ),
    'utf8',
  );
  const runtimeFixSql = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260906130000_pr32_portal_function_runtime_fix/migration.sql',
    ),
    'utf8',
  );
  const readPolicySql = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260907120000_pr33_customer_portal_read_policies/migration.sql',
    ),
    'utf8',
  );
  const tables = [
    'customer_portal_identities',
    'customer_portal_sessions',
    'customer_portal_invitations',
    'customer_portal_password_resets',
    'customer_portal_rate_limits',
  ];

  it.each(tables)('enables and forces RLS on %s', (table) => {
    expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
  });

  it('persists only opaque-token hashes and enforces scope in the database', () => {
    expect(sql).toContain('"refresh_token_hash" CHAR(64)');
    expect(sql).toContain('"token_hash" CHAR(64)');
    expect(sql).not.toMatch(/"refresh_token"\s/);
    expect(sql).not.toMatch(/"token"\s/);
    expect(sql).toContain('customer_portal_sessions_scope_fk');
    expect(sql).toContain('customer_portal_identity_scope_guard');
    expect(sql).toContain(
      "app_has_permission('customers.update') OR app_has_permission('*')",
    );
  });

  it('keeps auth bootstrap functions narrow and unavailable to PUBLIC', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION app_customer_portal_find_login(text,text) FROM PUBLIC',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION app_customer_portal_activate_invitation(text,text) FROM PUBLIC',
    );
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION app_customer_portal_consume_password_reset(text,text) FROM PUBLIC',
    );
  });

  it('qualifies the activation status predicate in the additive runtime fix', () => {
    expect(runtimeFixSql).toContain(
      "customer_portal_identities.status = 'INVITED'",
    );
    expect(runtimeFixSql).toContain(
      'REVOKE ALL ON FUNCTION app_customer_portal_activate_invitation(text,text) FROM PUBLIC',
    );
  });

  it('grants Portal operational access only through customer-scoped SELECT policies', () => {
    for (const policy of [
      'operations_portal_customer_read',
      'assets_portal_customer_read',
      'pmoc_plans_portal_customer_read',
      'rvt_configurations_portal_customer_read',
      'artifact_manifests_portal_customer_read',
      'storage_files_portal_document_read',
    ]) {
      expect(readPolicySql).toContain(`"${policy}"`);
    }
    expect(readPolicySql).toContain(
      "app_current_actor_type() = 'CUSTOMER_PORTAL'",
    );
    expect(readPolicySql).toContain('app_current_customer_id()');
    expect(readPolicySql).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE)/i);
  });
});
