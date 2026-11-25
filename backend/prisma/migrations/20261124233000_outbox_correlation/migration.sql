BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE identity_email_deliveries ADD COLUMN correlation_id varchar(64);
ALTER TABLE public_contact_submissions ADD COLUMN correlation_id varchar(64);
CREATE INDEX identity_email_redrive_expiry_idx ON identity_email_deliveries(expires_at)
WHERE status='FAILED' AND encrypted_payload IS NOT NULL;
CREATE INDEX contact_email_redrive_expiry_idx ON public_contact_submissions(expires_at)
WHERE status='FAILED' AND encrypted_payload IS NOT NULL;
COMMIT;
