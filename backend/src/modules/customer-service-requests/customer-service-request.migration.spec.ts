import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('PR-34 migration contract', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'prisma/migrations/20260908120000_pr34_customer_service_requests/migration.sql',
    ),
    'utf8',
  );

  it('creates the request and append-only timeline tables', () => {
    expect(sql).toContain('CREATE TABLE "customer_service_requests"');
    expect(sql).toContain('CREATE TABLE "customer_service_request_events"');
    expect(sql).not.toMatch(
      /CREATE POLICY[^;]+FOR (UPDATE|DELETE)[^;]+customer_service_request_events/i,
    );
  });

  it.each(['customer_service_requests', 'customer_service_request_events'])(
    'enables and forces RLS for %s',
    (table) => {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    },
  );

  it('has separate Portal and internal policies and Portal-only public events', () => {
    expect(sql).toContain('CREATE POLICY "csr_portal_select"');
    expect(sql).toContain('CREATE POLICY "csr_internal_select"');
    expect(sql).toContain('"visibility" = \'PORTAL\'');
    expect(sql).toContain('app_current_portal_identity_id()');
    expect(sql).toContain(
      "app_has_permission('customer_service_requests.manage')",
    );
  });

  it('enforces create and conversion idempotency in PostgreSQL', () => {
    expect(sql).toContain('"csr_portal_create_idempotency_key"');
    expect(sql).toContain('"csr_converted_operation_key"');
    expect(sql).toContain('"csr_conversion_idempotency_pair_check"');
  });
});
