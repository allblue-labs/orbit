CREATE TABLE public.http_idempotency_records (
  scope_hash char(64) PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  response_ciphertext text NOT NULL,
  expires_at timestamptz(3) NOT NULL
);
CREATE INDEX http_idempotency_expiry_idx ON public.http_idempotency_records(expires_at);
CREATE INDEX http_idempotency_organization_idx ON public.http_idempotency_records(organization_id);
CREATE INDEX http_idempotency_actor_idx ON public.http_idempotency_records(actor_id);

ALTER TABLE public.http_idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.http_idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY http_idempotency_actor ON public.http_idempotency_records
  FOR ALL
  USING (organization_id = app_current_organization_id() AND actor_id = app_current_user_id())
  WITH CHECK (organization_id = app_current_organization_id() AND actor_id = app_current_user_id());

-- The maintenance process sees/deletes only expired ciphertext. It has no
-- platform authority and cannot insert or update through these policies.
CREATE POLICY http_idempotency_expired_read ON public.http_idempotency_records
  FOR SELECT USING (current_setting('app.hotpath_cleanup', true) = 'true' AND expires_at <= statement_timestamp());
CREATE POLICY http_idempotency_expired_delete ON public.http_idempotency_records
  FOR DELETE USING (current_setting('app.hotpath_cleanup', true) = 'true' AND expires_at <= statement_timestamp());
GRANT SELECT, INSERT, DELETE ON public.http_idempotency_records TO orbit_app;
