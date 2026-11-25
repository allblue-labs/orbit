CREATE TABLE email_outbound_messages (
  id uuid PRIMARY KEY,
  region varchar(30) NOT NULL,
  source_hash char(64) NOT NULL CHECK (source_hash ~ '^[a-f0-9]{64}$'),
  recipient_hashes text[] NOT NULL CHECK (cardinality(recipient_hashes) BETWEEN 1 AND 50),
  identity_delivery_id uuid REFERENCES identity_email_deliveries(id) ON DELETE SET NULL ON UPDATE CASCADE,
  provider_message_id varchar(255),
  status varchar(20) NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','ACCEPTED','FAILED','UNKNOWN')),
  feedback_status varchar(20) NOT NULL DEFAULT 'UNOBSERVED' CHECK (feedback_status IN ('UNOBSERVED','HARD_BOUNCE','SOFT_BOUNCE','COMPLAINT','DELIVERY')),
  accepted_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE(region, provider_message_id), UNIQUE(id, region)
);
CREATE INDEX email_outbound_messages_identity_delivery_id_idx ON email_outbound_messages(identity_delivery_id);
CREATE TABLE email_provider_messages (
  region varchar(30) NOT NULL, provider_message_id varchar(255) NOT NULL,
  outbound_id uuid NOT NULL, created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY(region, provider_message_id),
  FOREIGN KEY(outbound_id,region) REFERENCES email_outbound_messages(id,region) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX email_provider_messages_outbound_id_idx ON email_provider_messages(outbound_id);
CREATE TABLE email_feedback_events (
  id uuid PRIMARY KEY, topic_arn varchar(300) NOT NULL, sns_message_id uuid NOT NULL,
  payload_hash char(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  kind varchar(30) NOT NULL CHECK (kind IN ('HARD_BOUNCE','SOFT_BOUNCE','COMPLAINT','DELIVERY','IGNORED','SUBSCRIPTION_CONFIRMATION','UNSUBSCRIBE_CONFIRMATION')),
  outbound_id uuid REFERENCES email_outbound_messages(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  recipient_hashes text[] NOT NULL CHECK (cardinality(recipient_hashes) BETWEEN 0 AND 50),
  status varchar(20) NOT NULL DEFAULT 'PROCESSED' CHECK (status IN ('PENDING','PROCESSING','PROCESSED')),
  lease_id uuid, lease_expires_at timestamptz(3), subscription_arn varchar(400), occurred_at timestamptz(3),
  created_at timestamptz(3) NOT NULL DEFAULT now(), updated_at timestamptz(3) NOT NULL DEFAULT now(),
  UNIQUE(topic_arn, sns_message_id),
  CHECK ((status='PROCESSING' AND lease_id IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status<>'PROCESSING' AND lease_id IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX email_feedback_events_outbound_id_idx ON email_feedback_events(outbound_id);
CREATE TABLE email_suppressions (
  recipient_hash char(64) PRIMARY KEY CHECK (recipient_hash ~ '^[a-f0-9]{64}$'),
  reason varchar(20) NOT NULL CHECK (reason IN ('HARD_BOUNCE','COMPLAINT')),
  feedback_event_id uuid NOT NULL REFERENCES email_feedback_events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  first_suppressed_at timestamptz(3) NOT NULL DEFAULT now(), last_observed_at timestamptz(3) NOT NULL DEFAULT now()
);
-- Only the dedicated email repository opens this context. It opens NO business table.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['email_outbound_messages','email_provider_messages','email_feedback_events','email_suppressions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY email_transport_only ON %I USING (current_setting(''app.email_transport'',true)=''true'') WITH CHECK (current_setting(''app.email_transport'',true)=''true'')',t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO orbit_app',t);
    EXECUTE format('REVOKE DELETE ON %I FROM orbit_app',t);
  END LOOP;
END $$;
