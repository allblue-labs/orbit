-- PR-36 closes two database-security gaps found by the fresh-schema audit.

-- The PMOC code counter is tenant-owned even though it is an internal table.
-- It must not rely only on the repository predicate or composite primary key.
ALTER TABLE pmoc_code_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE pmoc_code_sequences FORCE ROW LEVEL SECURITY;

CREATE POLICY pmoc_code_sequences_tenant_isolation
ON pmoc_code_sequences
FOR ALL
USING (
  app_is_platform_admin()
  OR organization_id = app_current_organization_id()
)
WITH CHECK (
  app_is_platform_admin()
  OR organization_id = app_current_organization_id()
);

-- Trigger functions execute through their triggers; callers never need direct
-- EXECUTE. PostgreSQL grants function execution to PUBLIC by default.
REVOKE ALL ON FUNCTION app_guard_customer_service_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_guard_customer_service_request_event() FROM PUBLIC;
