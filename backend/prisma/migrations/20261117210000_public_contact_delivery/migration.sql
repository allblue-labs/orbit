BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE public_contact_submissions (
 id uuid PRIMARY KEY,
 request_key char(64) NOT NULL UNIQUE,
 payload_hash char(64) NOT NULL,
 encrypted_payload text,
 status varchar(20) NOT NULL DEFAULT 'PENDING',
 attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz(3) NOT NULL DEFAULT now(),
 locked_at timestamptz(3), lease_id uuid,
 expires_at timestamptz(3) NOT NULL,
 accepted_at timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 updated_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT public_contact_status_valid CHECK(status IN ('PENDING','RUNNING','ACCEPTED','FAILED','SKIPPED')),
 CONSTRAINT public_contact_attempts_valid CHECK(attempts>=0),
 CONSTRAINT public_contact_payload_valid CHECK(status NOT IN ('PENDING','RUNNING') OR encrypted_payload IS NOT NULL)
);
CREATE INDEX public_contact_claim_idx ON public_contact_submissions(status,available_at);
CREATE INDEX public_contact_created_idx ON public_contact_submissions(created_at);
ALTER TABLE public_contact_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_contact_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY public_contact_read ON public_contact_submissions FOR SELECT USING (
 current_setting('app.public_contact_worker',true)='true' OR request_key=current_setting('app.public_contact_key',true));
CREATE POLICY public_contact_insert ON public_contact_submissions FOR INSERT WITH CHECK (
 request_key=current_setting('app.public_contact_key',true) AND status='PENDING' AND attempts=0
 AND lease_id IS NULL AND encrypted_payload IS NOT NULL AND expires_at>now()
 AND expires_at<=now()+interval '7 days');
CREATE POLICY public_contact_update ON public_contact_submissions FOR UPDATE
 USING(current_setting('app.public_contact_worker',true)='true') WITH CHECK(current_setting('app.public_contact_worker',true)='true');
CREATE POLICY public_contact_delete ON public_contact_submissions FOR DELETE USING (
 current_setting('app.public_contact_worker',true)='true' AND status IN ('ACCEPTED','FAILED','SKIPPED') AND created_at<now()-interval '30 days');
GRANT SELECT,INSERT,UPDATE,DELETE ON public_contact_submissions TO orbit_app;
ALTER TABLE email_outbound_messages ADD COLUMN contact_submission_id uuid;
ALTER TABLE email_outbound_messages ADD CONSTRAINT email_outbound_contact_fk FOREIGN KEY(contact_submission_id)
 REFERENCES public_contact_submissions(id) ON DELETE SET NULL;
CREATE INDEX email_outbound_contact_idx ON email_outbound_messages(contact_submission_id);
ALTER TABLE email_outbound_messages ADD CONSTRAINT email_outbound_one_delivery CHECK(identity_delivery_id IS NULL OR contact_submission_id IS NULL);
COMMIT;
