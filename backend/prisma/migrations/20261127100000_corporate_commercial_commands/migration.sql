BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.corporate_commercial_commands (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE ON UPDATE CASCADE,
  technical_principal_id uuid NOT NULL,
  operation varchar(32) NOT NULL CHECK (operation IN ('CHANGE_PLAN','KEEP','CANCEL_SCHEDULED_CHANGE','START_TRIAL')),
  key_hash char(64) NOT NULL,
  request_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT corporate_commercial_command_key UNIQUE (organization_id, technical_principal_id, operation, key_hash)
);
ALTER TABLE public.corporate_commercial_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_commercial_commands FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.corporate_commercial_commands TO orbit_app;

CREATE FUNCTION public.app_current_corporate_commercial_principal() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog,pg_temp AS $$
  SELECT NULLIF(current_setting('app.corporate_commercial_principal', true), '')::uuid
$$;

CREATE POLICY corporate_commercial_read ON public.corporate_commercial_commands FOR SELECT
  USING (organization_id = public.app_current_organization_id()
    AND technical_principal_id = public.app_current_corporate_commercial_principal());
CREATE POLICY corporate_commercial_insert ON public.corporate_commercial_commands FOR INSERT
  WITH CHECK (organization_id = public.app_current_organization_id()
    AND technical_principal_id = public.app_current_corporate_commercial_principal());

-- The canonical eligibility service needs the tenant's primary unit only.
CREATE POLICY corporate_commercial_primary_unit ON public.business_units FOR SELECT
  USING (organization_id = public.app_current_organization_id()
    AND public.app_current_corporate_commercial_principal() IS NOT NULL
    AND is_primary AND deleted_at IS NULL);

-- Global catalog reads and absent-tenant lookups have no tenant FK.
CREATE POLICY corporate_commercial_unscoped_audit ON public.audit_logs FOR INSERT
  WITH CHECK (organization_id IS NULL AND business_unit_id IS NULL AND user_id IS NULL
    AND entity_type = 'CORPORATE_COMMERCIAL'
    AND action = 'CORPORATE_COMMERCIAL_READ'
    AND metadata->>'technicalPrincipalId' = public.app_current_corporate_commercial_principal()::text);

COMMIT;
