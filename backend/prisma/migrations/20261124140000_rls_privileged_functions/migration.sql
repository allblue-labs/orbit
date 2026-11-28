BEGIN;

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['orbit_queue_worker','orbit_identity_definer','orbit_export_definer'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION',name);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.app_is_job_worker() RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SET search_path=pg_catalog,pg_temp AS $$
  SELECT pg_has_role(session_user, 'orbit_queue_worker', 'MEMBER')
    AND COALESCE(current_setting('app.job_worker',true)='true',false)
$$;

GRANT USAGE ON SCHEMA public TO orbit_identity_definer,orbit_export_definer;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','credentials','sessions','password_reset_tokens','identity_invitations','identity_biometric_credentials'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO orbit_identity_definer',t);
    EXECUTE format('CREATE POLICY auth_exact_resolver ON public.%I FOR SELECT TO orbit_identity_definer USING (true)',t);
  END LOOP;
END $$;
GRANT SELECT, DELETE ON public.auth_challenges TO orbit_identity_definer;
CREATE POLICY auth_challenge_expired_read ON public.auth_challenges FOR SELECT TO orbit_identity_definer
  USING (expires_at < statement_timestamp() - interval '1 hour');
CREATE POLICY auth_challenge_expired_delete ON public.auth_challenges FOR DELETE TO orbit_identity_definer
  USING (expires_at < statement_timestamp() - interval '1 hour');
ALTER FUNCTION public.app_identity_user_by_email(text) OWNER TO orbit_identity_definer;
ALTER FUNCTION public.app_identity_session_by_refresh(text) OWNER TO orbit_identity_definer;
ALTER FUNCTION public.app_identity_reset_user(text) OWNER TO orbit_identity_definer;
ALTER FUNCTION public.app_identity_invitation_by_hash(text) OWNER TO orbit_identity_definer;
ALTER FUNCTION public.app_identity_biometric_owner(uuid,text) OWNER TO orbit_identity_definer;
ALTER FUNCTION public.app_identity_cleanup_challenges() OWNER TO orbit_identity_definer;

GRANT SELECT ON public.document_exports TO orbit_export_definer;
CREATE POLICY export_quota_org ON public.document_exports FOR SELECT TO orbit_export_definer
  USING (organization_id=public.app_current_organization_id() OR public.app_is_platform_admin());
ALTER FUNCTION public.app_document_exports_in_progress(uuid) OWNER TO orbit_export_definer;

CREATE OR REPLACE FUNCTION public.app_reserve_registration_document(p_document text,p_organization uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE inserted bigint;
BEGIN
  IF p_organization IS NULL OR p_organization IS DISTINCT FROM public.app_current_organization_id() THEN
    RAISE EXCEPTION 'REGISTRATION_CONTEXT_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_document IS NULL OR p_document !~ '^[0-9]{11}([0-9]{3})?$' THEN
    RAISE EXCEPTION 'INVALID_REGISTRATION_DOCUMENT' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.account_document_registrations(document_number,organization_id)
    VALUES (p_document,p_organization) ON CONFLICT(document_number) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted=1;
END $$;

-- Existing triggers continue to run. Creating a new trigger requires a
-- separate EXECUTE grant, which runtime must never receive.
DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prorettype IN ('trigger'::regtype,'event_trigger'::regtype)
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, orbit_app',f.signature);
  END LOOP;
  EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC, orbit_app',current_database());
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.modules,public.pmoc_plan_name_options FROM orbit_app;

COMMIT;
