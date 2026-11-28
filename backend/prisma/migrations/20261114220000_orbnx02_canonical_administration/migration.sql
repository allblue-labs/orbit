CREATE TABLE platform_tenant_provisionings (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key char(64) NOT NULL,
  request_hash char(64) NOT NULL,
  correlation_id varchar(128) NOT NULL,
  plan_code varchar(60) NOT NULL,
  billing_interval varchar(20) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'RECEIVED',
  organization_id uuid UNIQUE REFERENCES organizations(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  primary_business_unit_id uuid,
  owner_password_provided boolean NOT NULL DEFAULT false,
  owner_setup_token_id uuid REFERENCES password_reset_tokens(id) ON DELETE SET NULL,
  last_error_code varchar(80),
  attempts integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  completed_at timestamptz(3),
  UNIQUE(actor_user_id, idempotency_key),
  CHECK(status IN ('RECEIVED','TENANT_CREATED','SUBSCRIPTION_READY','COMPLETED')),
  CHECK(billing_interval IN ('MONTHLY','SEMIANNUAL','ANNUAL')),
  CHECK(attempts >= 0 AND version > 0)
);
CREATE INDEX platform_tenant_provisionings_status_updated_at_idx
  ON platform_tenant_provisionings(status, updated_at);
ALTER TABLE platform_tenant_provisionings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_tenant_provisionings FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_tenant_provisionings_platform_only ON platform_tenant_provisionings
  USING(app_is_platform_admin()) WITH CHECK(app_is_platform_admin());
GRANT SELECT, INSERT, UPDATE ON platform_tenant_provisionings TO orbit_app;
