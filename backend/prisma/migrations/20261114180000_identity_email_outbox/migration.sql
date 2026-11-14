CREATE TABLE identity_email_deliveries (
  id UUID PRIMARY KEY, purpose VARCHAR(30) NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  token_hash CHAR(64) NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  encrypted_payload TEXT, expires_at TIMESTAMPTZ(3) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING', attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(), locked_at TIMESTAMPTZ(3), lease_id UUID,
  provider_message_id VARCHAR(255), last_error_code VARCHAR(80), finished_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT identity_email_purpose_valid CHECK (
    (purpose IN ('EMAIL_VERIFICATION','PASSWORD_RESET') AND user_id IS NOT NULL AND organization_id IS NULL)
    OR (purpose = 'INVITATION' AND organization_id IS NOT NULL AND user_id IS NULL)),
  CONSTRAINT identity_email_status_valid CHECK (status IN ('PENDING','RUNNING','ACCEPTED_BY_PROVIDER','SKIPPED','FAILED')),
  CONSTRAINT identity_email_lease_valid CHECK ((status = 'RUNNING' AND locked_at IS NOT NULL AND lease_id IS NOT NULL)
    OR (status <> 'RUNNING' AND locked_at IS NULL AND lease_id IS NULL)),
  CONSTRAINT identity_email_payload_valid CHECK ((status IN ('PENDING','RUNNING')) = (encrypted_payload IS NOT NULL)),
  UNIQUE (purpose, token_hash)
);
CREATE INDEX identity_email_deliveries_status_available_at_idx ON identity_email_deliveries(status, available_at);
CREATE INDEX identity_email_deliveries_status_locked_at_idx ON identity_email_deliveries(status, locked_at);
CREATE INDEX identity_email_deliveries_provider_message_id_idx ON identity_email_deliveries(provider_message_id);
ALTER TABLE identity_email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_email_deliveries FORCE ROW LEVEL SECURITY;
-- This setting grants worker access ONLY to the outbox; no tenant table uses it.
CREATE POLICY identity_email_worker ON identity_email_deliveries FOR ALL
  USING (current_setting('app.identity_email_worker', true) = 'true')
  WITH CHECK (current_setting('app.identity_email_worker', true) = 'true');
CREATE POLICY identity_email_enqueue ON identity_email_deliveries FOR INSERT
  WITH CHECK ((user_id = app_current_user_id() AND organization_id IS NULL)
    OR (organization_id = app_current_organization_id() AND user_id IS NULL));
GRANT SELECT, INSERT, UPDATE, DELETE ON identity_email_deliveries TO orbit_app;
