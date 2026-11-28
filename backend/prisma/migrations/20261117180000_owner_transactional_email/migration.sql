BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='120s';
-- Positive, immutable provenance: a team role or a plausible email domain is insufficient.
CREATE TABLE account_email_owners (
 user_id uuid PRIMARY KEY, registration_organization_id uuid NOT NULL UNIQUE,
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 CONSTRAINT ses_owner_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
 CONSTRAINT ses_owner_org_fk FOREIGN KEY(registration_organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);
-- Existing self-service accounts only. Do not create welcome messages during upgrade.
INSERT INTO account_email_owners(user_id,registration_organization_id)
 SELECT DISTINCT ON (o.owner_user_id) o.owner_user_id,o.id
 FROM account_document_registrations r JOIN organizations o ON o.id=r.organization_id
 LEFT JOIN LATERAL (SELECT user_id FROM organization_legal_acceptances a WHERE a.organization_id=o.id ORDER BY accepted_at,id LIMIT 1) original ON true
 WHERE original.user_id=o.owner_user_id OR EXISTS(SELECT 1 FROM platform_tenant_provisionings p WHERE p.organization_id=o.id AND p.owner_user_id=o.owner_user_id AND p.status IN ('SUBSCRIPTION_READY','COMPLETED'))
 ORDER BY o.owner_user_id,o.created_at,o.id;
ALTER TABLE account_email_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_email_owners FORCE ROW LEVEL SECURITY;
CREATE POLICY account_email_owner_read ON account_email_owners FOR SELECT USING
 (user_id=app_current_user_id() OR current_setting('app.identity_email_worker',true)='true' OR app_is_platform_admin());
GRANT SELECT ON account_email_owners TO orbit_app;
REVOKE INSERT,UPDATE,DELETE ON account_email_owners FROM orbit_app;
CREATE FUNCTION app_register_account_email_owner(p_user uuid,p_organization uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organizations o JOIN public.account_document_registrations r ON r.organization_id=o.id
   WHERE o.id=p_organization AND o.owner_user_id=p_user AND (
     (p_user=public.app_current_user_id() AND p_organization=public.app_current_organization_id()
       AND p_user=(SELECT a.user_id FROM public.organization_legal_acceptances a WHERE a.organization_id=o.id ORDER BY a.accepted_at,a.id LIMIT 1))
     OR (public.app_is_platform_admin() AND EXISTS(SELECT 1 FROM public.platform_tenant_provisionings p
       WHERE p.organization_id=o.id AND p.owner_user_id=p_user
       AND p.status='SUBSCRIPTION_READY')))) THEN
   RAISE EXCEPTION 'ACCOUNT_EMAIL_OWNER_PROVENANCE_INVALID' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.account_email_owners(user_id,registration_organization_id) VALUES(p_user,p_organization) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.account_email_owners WHERE user_id=p_user AND registration_organization_id=p_organization) THEN
   RAISE EXCEPTION 'ACCOUNT_EMAIL_OWNER_ALREADY_BOUND' USING ERRCODE='23505';
 END IF;
END $$;
REVOKE ALL ON FUNCTION app_register_account_email_owner(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_register_account_email_owner(uuid,uuid) TO orbit_app;
-- Resolve the current address only within its identity/tenant context or the dedicated mail worker.
CREATE FUNCTION app_account_email_owner(p_user uuid)
 RETURNS TABLE(user_id uuid,organization_id uuid,email text,display_name text,verified_at timestamptz)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT u.id,o.id,u.email::text,u.display_name::text,u.email_verified_at
 FROM public.account_email_owners a JOIN public.users u ON u.id=a.user_id
 JOIN public.organizations o ON o.id=a.registration_organization_id AND o.owner_user_id=u.id
 WHERE u.id=p_user AND u.deleted_at IS NULL AND u.status='ACTIVE' AND o.deleted_at IS NULL
 AND (u.id=public.app_current_user_id() OR current_setting('app.identity_email_worker',true)='true' OR public.app_is_platform_admin()
   OR EXISTS(SELECT 1 FROM public.organizations own WHERE own.id=public.app_current_organization_id() AND own.owner_user_id=u.id))
$$;
REVOKE ALL ON FUNCTION app_account_email_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_account_email_owner(uuid) TO orbit_app;
ALTER TABLE identity_email_deliveries DROP CONSTRAINT identity_email_purpose_valid;
ALTER TABLE identity_email_deliveries ADD CONSTRAINT identity_email_purpose_valid CHECK (
 (purpose IN ('EMAIL_VERIFICATION','PASSWORD_RESET','PASSWORD_CHANGED','PLAN_EXPIRED','PLAN_LIMIT_REACHED') AND user_id IS NOT NULL AND organization_id IS NULL)
 OR (purpose='INVITATION' AND organization_id IS NOT NULL AND user_id IS NULL));
CREATE INDEX identity_email_owner_budget_idx ON identity_email_deliveries(user_id,purpose,created_at);
COMMIT;
