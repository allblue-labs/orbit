BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE background_jobs ADD COLUMN redrive_generation integer NOT NULL DEFAULT 0;
CREATE TABLE background_job_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  attempt integer NOT NULL,
  generation integer NOT NULL,
  status varchar(20) NOT NULL,
  code varchar(160) NOT NULL,
  recorded_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT background_job_failures_job_scope_fk FOREIGN KEY (job_id, organization_id)
    REFERENCES background_jobs(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX background_job_failures_job_time_idx ON background_job_failures(job_id, recorded_at DESC);
CREATE INDEX background_jobs_dlq_time_idx ON background_jobs(finished_at DESC, id DESC)
  WHERE status IN ('DEAD','FAILED');
ALTER TABLE background_job_failures ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_job_failures FORCE ROW LEVEL SECURITY;
CREATE POLICY job_failure_admin_read ON background_job_failures FOR SELECT USING (app_is_platform_admin());
CREATE POLICY job_failure_worker_append ON background_job_failures FOR INSERT WITH CHECK (app_is_job_worker());

CREATE FUNCTION app_record_job_failure() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog,public,pg_temp AS $$
BEGIN
  IF OLD.status = 'RUNNING' AND NEW.status IN ('PENDING','DEAD','FAILED')
     AND NEW.last_error IS NOT NULL AND NEW.attempts >= OLD.attempts THEN
    INSERT INTO public.background_job_failures (job_id,organization_id,attempt,generation,status,code)
    VALUES (NEW.id,NEW.organization_id,NEW.attempts,NEW.redrive_generation,NEW.status,
      CASE WHEN NEW.last_error ~ '^[A-Z0-9_.:-]{1,160}$' THEN NEW.last_error ELSE 'UNCLASSIFIED_FAILURE' END);
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app_record_job_failure() FROM PUBLIC;
CREATE TRIGGER record_job_failure AFTER UPDATE OF status ON background_jobs
  FOR EACH ROW EXECUTE FUNCTION app_record_job_failure();

ALTER TABLE identity_email_deliveries ADD COLUMN admin_requeued_at timestamptz(3);
ALTER TABLE identity_email_deliveries DROP CONSTRAINT identity_email_payload_valid;
ALTER TABLE identity_email_deliveries ADD CONSTRAINT identity_email_payload_valid CHECK (
  (status IN ('PENDING','RUNNING') AND encrypted_payload IS NOT NULL)
  OR (status IN ('ACCEPTED_BY_PROVIDER','SKIPPED','FAILED') AND encrypted_payload IS NULL)
  OR (status='FAILED' AND encrypted_payload IS NOT NULL AND admin_requeued_at IS NULL
    AND last_error_code IS NOT NULL AND last_error_code IN (
      'SES_IDENTITY_NOT_VERIFIED','SES_SENDING_PAUSED','SES_ACCESS_DENIED',
      'SES_ACCOUNT_SUSPENDED','AWS_CREDENTIALS_REJECTED','AWS_CREDENTIALS_EXPIRED'
    ))
);
ALTER TABLE public_contact_submissions ADD COLUMN admin_requeued_at timestamptz(3);
ALTER TABLE public_contact_submissions ADD COLUMN last_error_code varchar(80);
CREATE POLICY identity_email_admin_read ON identity_email_deliveries FOR SELECT
  USING (app_is_platform_admin() AND (status = 'FAILED' OR admin_requeued_at IS NOT NULL));
CREATE POLICY identity_email_admin_redrive ON identity_email_deliveries FOR UPDATE
  USING (app_is_platform_admin() AND status = 'FAILED')
  WITH CHECK (app_is_platform_admin() AND status = 'PENDING' AND admin_requeued_at IS NOT NULL);
CREATE POLICY public_contact_admin_read ON public_contact_submissions FOR SELECT
  USING (app_is_platform_admin() AND (status = 'FAILED' OR admin_requeued_at IS NOT NULL));
CREATE POLICY public_contact_admin_redrive ON public_contact_submissions FOR UPDATE
  USING (app_is_platform_admin() AND status = 'FAILED')
  WITH CHECK (app_is_platform_admin() AND status = 'PENDING' AND admin_requeued_at IS NOT NULL);
CREATE POLICY email_outbound_admin_read ON email_outbound_messages FOR SELECT
  USING (app_is_platform_admin());
COMMIT;
