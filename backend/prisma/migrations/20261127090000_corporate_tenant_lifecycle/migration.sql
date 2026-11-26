BEGIN;

ALTER TABLE public.platform_tenant_provisionings
  ALTER COLUMN actor_user_id DROP NOT NULL,
  ADD COLUMN technical_principal_id uuid,
  ADD CONSTRAINT platform_provisioning_actor_valid CHECK (
    (actor_user_id IS NOT NULL) <> (technical_principal_id IS NOT NULL)
    AND (technical_principal_id IS NULL OR NOT owner_password_provided)
  ),
  ADD CONSTRAINT platform_provisioning_technical_key UNIQUE (technical_principal_id, idempotency_key);

-- This setting scopes only the existing workflow rows to a technical principal.
-- It grants no platform authority. Tenant mutations use the normal tenant RLS.
CREATE FUNCTION public.app_current_corporate_provisioner() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT NULLIF(current_setting('app.corporate_provisioner', true), '')::uuid
$$;
CREATE POLICY corporate_provisioning_read ON public.platform_tenant_provisionings FOR SELECT
  USING (technical_principal_id = public.app_current_corporate_provisioner());
CREATE POLICY corporate_provisioning_insert ON public.platform_tenant_provisionings FOR INSERT
  WITH CHECK (
    technical_principal_id = public.app_current_corporate_provisioner()
    AND status = 'RECEIVED' AND organization_id IS NULL AND owner_user_id IS NULL
    AND primary_business_unit_id IS NULL AND owner_setup_token_id IS NULL
  );
CREATE POLICY corporate_provisioning_update ON public.platform_tenant_provisionings FOR UPDATE
  USING (technical_principal_id = public.app_current_corporate_provisioner())
  WITH CHECK (
    technical_principal_id = public.app_current_corporate_provisioner()
    AND (organization_id IS NULL OR organization_id = public.app_current_organization_id())
  );
CREATE POLICY corporate_provisioning_audit ON public.audit_logs FOR INSERT
  WITH CHECK (
    user_id IS NULL AND business_unit_id IS NULL AND entity_type = 'PLATFORM_ADMINISTRATION'
    AND action IN ('PLATFORM_TENANT_PROVISIONING', 'PLATFORM_TENANT_PROVISIONING_REJECTED',
      'PLATFORM_PROVISIONING_READ', 'PLATFORM_TENANT_PROVISIONING_RESULT', 'PLATFORM_TENANT_PROVISIONING_RESUME')
    AND metadata->>'technicalPrincipalId' = public.app_current_corporate_provisioner()::text
    AND (organization_id IS NULL OR organization_id = public.app_current_organization_id())
  );

CREATE POLICY corporate_lifecycle_missing_target_audit ON public.audit_logs FOR INSERT
  WITH CHECK (
    user_id IS NULL AND organization_id IS NULL AND business_unit_id IS NULL
    AND entity_type = 'ORGANIZATION' AND action = 'TENANT_OPERATIONAL_STATUS_REJECTED'
    AND entity_id = public.app_current_organization_id()
    AND metadata->>'technicalPrincipalId' = NULLIF(current_setting('app.corporate_operational_principal', true), '')
  );

-- Preserve both previous paths. The new branch proves the same original-owner
-- provenance with the exact corporate workflow and its tenant scope.
CREATE OR REPLACE FUNCTION public.app_register_account_email_owner(p_user uuid,p_organization uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.organizations o JOIN public.account_document_registrations r ON r.organization_id=o.id
   WHERE o.id=p_organization AND o.owner_user_id=p_user AND (
     (p_user=public.app_current_user_id() AND p_organization=public.app_current_organization_id()
       AND p_user=(SELECT a.user_id FROM public.organization_legal_acceptances a WHERE a.organization_id=o.id ORDER BY a.accepted_at,a.id LIMIT 1))
     OR EXISTS(SELECT 1 FROM public.platform_tenant_provisionings p
       WHERE p.organization_id=o.id AND p.owner_user_id=p_user AND p.status='SUBSCRIPTION_READY'
       AND (public.app_is_platform_admin() OR
         (p_organization=public.app_current_organization_id()
           AND p.technical_principal_id=public.app_current_corporate_provisioner()))))) THEN
   RAISE EXCEPTION 'ACCOUNT_EMAIL_OWNER_PROVENANCE_INVALID' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.account_email_owners(user_id,registration_organization_id) VALUES(p_user,p_organization) ON CONFLICT DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM public.account_email_owners WHERE user_id=p_user AND registration_organization_id=p_organization) THEN
   RAISE EXCEPTION 'ACCOUNT_EMAIL_OWNER_ALREADY_BOUND' USING ERRCODE='23505';
 END IF;
END $$;

-- Return only delivery status for the exact setup token of this workflow.
-- During staging of the owner setup, the caller can verify the pending reset
-- before completing the operation. No recipient, token hash or payload leaves SQL.
CREATE FUNCTION public.app_corporate_owner_setup_delivery(p_operation uuid, p_reset uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE
    WHEN r.used_at IS NOT NULL THEN 'PASSWORD_CONFIGURED'
    WHEN r.expires_at <= statement_timestamp() THEN 'EXPIRED'
    ELSE d.status
  END
  FROM public.platform_tenant_provisionings p
  JOIN public.password_reset_tokens r ON r.id = p_reset AND r.user_id = p.owner_user_id
  JOIN public.identity_email_deliveries d ON d.user_id = r.user_id
    AND d.token_hash = r.token_hash AND d.purpose = 'PASSWORD_RESET'
  WHERE p.id = p_operation AND p.organization_id = public.app_current_organization_id()
    AND p.technical_principal_id = public.app_current_corporate_provisioner()
    AND ((p.status = 'SUBSCRIPTION_READY' AND r.user_id = public.app_current_user_id())
      OR (p.status = 'COMPLETED' AND p.owner_setup_token_id = r.id))
$$;
REVOKE ALL ON FUNCTION public.app_corporate_owner_setup_delivery(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_corporate_owner_setup_delivery(uuid, uuid) TO orbit_app;

COMMIT;
