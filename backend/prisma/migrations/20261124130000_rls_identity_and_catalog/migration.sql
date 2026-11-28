BEGIN;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_identity ON public.users FOR ALL
  USING (id=public.app_current_user_id() OR public.app_is_platform_admin())
  WITH CHECK (id=public.app_current_user_id() OR public.app_is_platform_admin());
CREATE POLICY users_roster ON public.users FOR SELECT USING (EXISTS (
  SELECT 1 FROM public.organization_memberships m
  WHERE m.user_id=users.id AND m.organization_id=public.app_current_organization_id()
));

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['credentials','mfa_factors','sessions','password_reset_tokens','identity_biometric_credentials'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY identity_self ON public.%I FOR ALL
      USING (user_id=public.app_current_user_id() OR public.app_is_platform_admin())
      WITH CHECK (user_id=public.app_current_user_id() OR public.app_is_platform_admin())',t);
  END LOOP;
END $$;

ALTER TABLE public.identity_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.identity_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY invitations_tenant ON public.identity_invitations FOR ALL
  USING (organization_id=public.app_current_organization_id() OR public.app_is_platform_admin())
  WITH CHECK (organization_id=public.app_current_organization_id() OR public.app_is_platform_admin());

ALTER TABLE public.auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_challenges FORCE ROW LEVEL SECURITY;
CREATE POLICY auth_challenges_capability ON public.auth_challenges FOR ALL
  USING (id=NULLIF(current_setting('app.auth_challenge_id',true),'')::uuid)
  WITH CHECK (id=NULLIF(current_setting('app.auth_challenge_id',true),'')::uuid);

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans FORCE ROW LEVEL SECURITY;
CREATE POLICY plans_visible ON public.plans FOR SELECT
  USING (catalog_tenant_id IS NULL OR catalog_tenant_id=public.app_current_organization_id());
CREATE POLICY plans_platform ON public.plans FOR ALL
  USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin());
DROP POLICY plan_stripe_prices_read ON public.plan_stripe_prices;
CREATE POLICY plan_stripe_prices_read ON public.plan_stripe_prices FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.plans p WHERE p.key=plan_stripe_prices.plan_code));

-- Unauthenticated identity flows may resolve a single record by an exact
-- selector. Authenticated reads and subsequent writes use local identity
-- context; there is no policy granting general table access before login.
CREATE FUNCTION public.app_identity_user_by_email(p_email text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT id FROM public.users WHERE normalized_email=p_email
$$;
CREATE FUNCTION public.app_identity_session_by_refresh(p_hash text)
RETURNS TABLE (id uuid, "userId" uuid, client varchar, "refreshTokenHash" varchar, "rotationResponse" text, "inGrace" boolean)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT id,user_id,client,refresh_token_hash,rotation_response,
         COALESCE(rotation_grace_until>clock_timestamp(),false)
  FROM public.sessions
  WHERE length(p_hash)=64 AND (refresh_token_hash=p_hash OR previous_refresh_token_hash=p_hash)
    AND revoked_at IS NULL AND expires_at>clock_timestamp()
$$;
CREATE FUNCTION public.app_identity_reset_user(p_hash text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT r.user_id FROM public.password_reset_tokens r
  JOIN public.users u ON u.id=r.user_id AND u.status='ACTIVE' AND u.deleted_at IS NULL
  JOIN public.credentials c ON c.user_id=u.id
  WHERE length(p_hash)=64 AND r.token_hash=p_hash
$$;
CREATE FUNCTION public.app_identity_invitation_by_hash(p_hash text) RETURNS SETOF public.identity_invitations
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT i.* FROM public.identity_invitations i WHERE length(p_hash)=64 AND i.token_hash=p_hash
$$;
CREATE FUNCTION public.app_identity_biometric_owner(p_id uuid,p_webauthn text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  SELECT user_id FROM public.identity_biometric_credentials
  WHERE revoked_at IS NULL AND (
    (p_id IS NOT NULL AND p_webauthn IS NULL AND id=p_id)
    OR (p_id IS NULL AND p_webauthn IS NOT NULL AND webauthn_credential_id=p_webauthn)
  )
$$;
CREATE FUNCTION public.app_identity_cleanup_challenges() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
  DELETE FROM public.auth_challenges WHERE id IN (SELECT id FROM public.auth_challenges
    WHERE expires_at < statement_timestamp() - interval '1 hour' ORDER BY expires_at LIMIT 100)
$$;

REVOKE ALL ON FUNCTION public.app_identity_user_by_email(text),
  public.app_identity_session_by_refresh(text), public.app_identity_reset_user(text),
  public.app_identity_invitation_by_hash(text), public.app_identity_biometric_owner(uuid,text),
  public.app_identity_cleanup_challenges() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_identity_user_by_email(text),
  public.app_identity_session_by_refresh(text), public.app_identity_reset_user(text),
  public.app_identity_invitation_by_hash(text), public.app_identity_biometric_owner(uuid,text),
  public.app_identity_cleanup_challenges() TO orbit_app;
COMMIT;
