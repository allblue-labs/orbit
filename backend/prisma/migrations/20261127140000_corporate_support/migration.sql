BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.billing_support_tickets
  ADD COLUMN support_priority varchar(12) NOT NULL DEFAULT 'NORMAL' CHECK (support_priority IN ('LOW','NORMAL','HIGH','URGENT')),
  ADD COLUMN support_assignee_id uuid,
  ADD COLUMN support_version integer NOT NULL DEFAULT 1,
  ADD COLUMN support_updated_at timestamptz(3),
  ADD CONSTRAINT billing_support_ticket_tenant_key UNIQUE (id, organization_id);

-- Share an optimistic version with the legacy platform-admin resolution path.
CREATE FUNCTION public.app_billing_ticket_support_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF (NEW.status, NEW.support_priority, NEW.support_assignee_id, NEW.resolution, NEW.resolved_at)
      IS DISTINCT FROM (OLD.status, OLD.support_priority, OLD.support_assignee_id, OLD.resolution, OLD.resolved_at)
    OR NEW.support_version IS DISTINCT FROM OLD.support_version THEN
    NEW.support_version := OLD.support_version + 1;
    NEW.support_updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_support_version BEFORE UPDATE ON public.billing_support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.app_billing_ticket_support_version();

CREATE TABLE public.corporate_support_tickets (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title varchar(160) NOT NULL,
  category varchar(30) NOT NULL CHECK (category IN ('ACCOUNT_ACCESS','TECHNICAL','GENERAL')),
  priority varchar(12) NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status varchar(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  assignee_id uuid,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at timestamptz(3),
  UNIQUE (id, organization_id)
);
CREATE INDEX corporate_support_tickets_org_queue ON public.corporate_support_tickets (organization_id, status, id DESC);
CREATE INDEX corporate_support_tickets_queue ON public.corporate_support_tickets (status, id DESC);
CREATE TABLE public.corporate_support_interactions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  administrative_ticket_id uuid,
  billing_ticket_id uuid,
  kind varchar(20) NOT NULL CHECK (kind IN ('CREATED','UPDATED','INTERNAL_NOTE','RESOLVED')),
  body varchar(2000),
  changes jsonb,
  nexus_administrator_id uuid NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((administrative_ticket_id IS NULL) <> (billing_ticket_id IS NULL)),
  FOREIGN KEY (administrative_ticket_id, organization_id) REFERENCES public.corporate_support_tickets(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (billing_ticket_id, organization_id) REFERENCES public.billing_support_tickets(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX corporate_support_interactions_admin ON public.corporate_support_interactions (administrative_ticket_id, id DESC);
CREATE INDEX corporate_support_interactions_billing ON public.corporate_support_interactions (billing_ticket_id, id DESC);
CREATE TABLE public.corporate_support_requests (
  technical_principal_id uuid NOT NULL,
  key_hash char(64) NOT NULL,
  request_hash char(64) NOT NULL,
  receipt jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (technical_principal_id, key_hash)
);

CREATE FUNCTION public.app_corporate_support_principal() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NULLIF(current_setting('app.corporate_support_principal', true), '')::uuid
$$;
CREATE FUNCTION public.app_corporate_support_scope(p_operations text[], p_organization uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT public.app_corporate_support_principal() IS NOT NULL
    AND public.app_current_user_id() IS NULL AND NOT public.app_is_platform_admin()
    AND current_setting('app.corporate_support_operation', true) = ANY(p_operations)
    AND public.app_current_organization_id() IS NOT DISTINCT FROM p_organization
    AND (p_organization IS NULL OR p_organization::text = current_setting('app.corporate_support_organization', true))
$$;
REVOKE ALL ON FUNCTION public.app_corporate_support_principal(), public.app_corporate_support_scope(text[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_corporate_support_principal(), public.app_corporate_support_scope(text[], uuid) TO orbit_app;

ALTER TABLE public.corporate_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_support_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_support_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_support_interactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_support_requests FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.corporate_support_tickets TO orbit_app;
GRANT SELECT, INSERT ON public.corporate_support_interactions, public.corporate_support_requests TO orbit_app;

CREATE POLICY corporate_support_ticket_read ON public.corporate_support_tickets FOR SELECT TO orbit_app USING (
  public.app_corporate_support_scope(ARRAY['SUPPORT_READ','SUPPORT_CREATE','SUPPORT_UPDATE'])
  OR public.app_corporate_support_scope(ARRAY['ORG_DIAGNOSTICS'], organization_id));
CREATE POLICY corporate_support_ticket_insert ON public.corporate_support_tickets FOR INSERT TO orbit_app
  WITH CHECK (public.app_corporate_support_scope(ARRAY['SUPPORT_CREATE']));
CREATE POLICY corporate_support_ticket_update ON public.corporate_support_tickets FOR UPDATE TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['SUPPORT_UPDATE']))
  WITH CHECK (public.app_corporate_support_scope(ARRAY['SUPPORT_UPDATE']));
CREATE POLICY corporate_support_billing_read ON public.billing_support_tickets FOR SELECT TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['SUPPORT_READ','SUPPORT_UPDATE']));
CREATE POLICY corporate_support_billing_update ON public.billing_support_tickets FOR UPDATE TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['SUPPORT_UPDATE']))
  WITH CHECK (public.app_corporate_support_scope(ARRAY['SUPPORT_UPDATE']));
CREATE POLICY corporate_support_interaction_read ON public.corporate_support_interactions FOR SELECT TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['SUPPORT_READ']));
CREATE POLICY corporate_support_interaction_append ON public.corporate_support_interactions FOR INSERT TO orbit_app
  WITH CHECK (public.app_corporate_support_scope(ARRAY['SUPPORT_CREATE','SUPPORT_UPDATE']));
CREATE POLICY corporate_support_request_read ON public.corporate_support_requests FOR SELECT TO orbit_app
  USING (technical_principal_id = public.app_corporate_support_principal()
    AND public.app_corporate_support_scope(ARRAY['SUPPORT_CREATE','SUPPORT_UPDATE','PROVISIONING_RECOVERY']));
CREATE POLICY corporate_support_request_insert ON public.corporate_support_requests FOR INSERT TO orbit_app
  WITH CHECK (technical_principal_id = public.app_corporate_support_principal()
    AND public.app_corporate_support_scope(ARRAY['SUPPORT_CREATE','SUPPORT_UPDATE','PROVISIONING_RECOVERY']));

CREATE POLICY corporate_support_organization_read ON public.organizations FOR SELECT TO orbit_app
  USING (deleted_at IS NULL AND public.app_corporate_support_scope(ARRAY['SUPPORT_READ','SUPPORT_CREATE','SUPPORT_UPDATE']));
CREATE POLICY corporate_support_owner_read ON public.users FOR SELECT TO orbit_app
  USING (EXISTS (SELECT 1 FROM public.organizations o WHERE o.owner_user_id = users.id AND o.deleted_at IS NULL
    AND public.app_corporate_support_scope(ARRAY['ORG_DIAGNOSTICS'], o.id)));
CREATE POLICY corporate_support_owner_credential_read ON public.credentials FOR SELECT TO orbit_app
  USING (EXISTS (SELECT 1 FROM public.organizations o WHERE o.owner_user_id = credentials.user_id AND o.deleted_at IS NULL
    AND public.app_corporate_support_scope(ARRAY['ORG_DIAGNOSTICS'], o.id)));
CREATE POLICY corporate_support_workflow_read ON public.platform_tenant_provisionings FOR SELECT TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['OPERATIONS'])
    OR public.app_corporate_support_scope(ARRAY['ORG_DIAGNOSTICS'], organization_id));
CREATE POLICY corporate_support_stripe_event_read ON public.billing_webhook_events FOR SELECT TO orbit_app
  USING (provider = 'STRIPE' AND public.app_corporate_support_scope(ARRAY['INTEGRATIONS','OPERATIONS']));
CREATE POLICY corporate_support_stripe_checkpoint_read ON public.billing_recovery_checkpoints FOR SELECT TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['INTEGRATIONS','OPERATIONS']));
CREATE POLICY corporate_support_identity_queue_read ON public.identity_email_deliveries FOR SELECT TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['INTEGRATIONS','OPERATIONS']));
CREATE POLICY corporate_support_contact_queue_read ON public.public_contact_submissions FOR SELECT TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['INTEGRATIONS','OPERATIONS']));

CREATE POLICY corporate_support_audit ON public.audit_logs FOR INSERT TO orbit_app WITH CHECK (
  organization_id IS NULL AND business_unit_id IS NULL AND user_id IS NULL
  AND entity_type = 'CORPORATE_SUPPORT'
  AND action IN ('CORPORATE_SUPPORT_READ','CORPORATE_SUPPORT_ATTEMPT','CORPORATE_SUPPORT_RESULT')
  AND metadata->>'technicalPrincipalId' = public.app_corporate_support_principal()::text
  AND metadata->>'operation' = current_setting('app.corporate_support_operation', true)
  AND (public.app_corporate_support_scope(ARRAY['SUPPORT_READ','SUPPORT_CREATE','SUPPORT_UPDATE','INTEGRATIONS','OPERATIONS','PROVISIONING_RECOVERY'])
    OR public.app_corporate_support_scope(ARRAY['ORG_DIAGNOSTICS'], entity_id))
);
COMMIT;
