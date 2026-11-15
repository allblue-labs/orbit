-- NX04: additive only. Unknown historical webhook mode stays NULL and is quarantined.
ALTER TABLE billing_invoices ADD COLUMN payment_evidence JSONB NOT NULL DEFAULT '[]';
ALTER TABLE billing_webhook_events ADD COLUMN mode VARCHAR(10),
 ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'WEBHOOK';
ALTER TABLE billing_webhook_events ADD CONSTRAINT billing_event_mode_valid CHECK(mode IN ('TEST','LIVE'));
CREATE TABLE billing_recovery_checkpoints (
 key VARCHAR(80) PRIMARY KEY, mode VARCHAR(10) NOT NULL CHECK(mode IN ('TEST','LIVE')),
 stream VARCHAR(20) NOT NULL CHECK(stream IN ('EVENTS','SUBSCRIPTIONS')),
 cursor JSONB NOT NULL DEFAULT '{}', token UUID, lease_until TIMESTAMPTZ(3),
 next_run_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(), attempts INT NOT NULL DEFAULT 0,
 status VARCHAR(20) NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','RUNNING','DEAD_LETTER')),
 last_error_code VARCHAR(80), last_completed_at TIMESTAMPTZ(3),
 updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT now(), stats JSONB NOT NULL DEFAULT '{}'
);
ALTER TABLE billing_recovery_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_recovery_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY billing_recovery_platform_only ON billing_recovery_checkpoints
 USING(app_is_platform_admin()) WITH CHECK(app_is_platform_admin());
GRANT SELECT, INSERT, UPDATE ON billing_recovery_checkpoints TO orbit_app;
-- Narrow lease assertion: no payload or cross-tenant read is exposed. Lock fences
-- the persistence transaction against reclamation; a lost lease aborts all writes.
CREATE FUNCTION billing_assert_event_lease(event_id UUID, claim_token UUID) RETURNS VOID
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
 PERFORM 1 FROM public.billing_webhook_events WHERE id=event_id
  AND processing_token=claim_token AND processing_status='PROCESSING'
  AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'BILLING_LEASE_LOST' USING ERRCODE='40001'; END IF;
END $$;
REVOKE ALL ON FUNCTION billing_assert_event_lease(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_assert_event_lease(UUID, UUID) TO orbit_app;

ALTER TABLE billing_invoice_transitions ADD COLUMN source_event_type VARCHAR(120),
 ADD COLUMN source_occurred_at TIMESTAMPTZ(3), ADD COLUMN adjustment_fact JSONB;

ALTER TABLE billing_webhook_events ADD COLUMN reconciliation_outcome VARCHAR(30);

CREATE INDEX billing_events_mode_backlog ON billing_webhook_events(mode,processing_status,received_at);
CREATE INDEX billing_events_recovery_completed ON billing_webhook_events(mode,processed_at) WHERE source='RECOVERY';

-- Monotonic read tickets are issued BEFORE remote reads. Ordering never relies
-- on clocks of separate replicas. A delayed read cannot replace a newer ticket.
CREATE SEQUENCE billing_observation_sequence AS BIGINT;
GRANT USAGE, SELECT ON SEQUENCE billing_observation_sequence TO orbit_app;
ALTER TABLE organization_subscriptions ADD COLUMN provider_observation_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE billing_invoices ADD COLUMN observation_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE billing_financial_adjustments ADD COLUMN observation_version BIGINT NOT NULL DEFAULT 0;
