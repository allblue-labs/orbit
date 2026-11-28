-- One round trip under the restricted application role. SET clauses keep
-- identity settings local to this function, including in pooled connections.
CREATE FUNCTION public.app_hotpath_access(p_session uuid, p_user uuid)
RETURNS TABLE (
  client text, organization_id uuid, cacheable boolean, access_version text,
  organization_status text, operational boolean, billing_version text
)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
SET app.is_platform_admin = 'false'
SET app.actor_type = 'INTERNAL_USER'
SET app.user_id = ''
SET app.organization_id = ''
SET app.business_unit_ids = ''
AS $$
DECLARE
  selected_org uuid;
  selected_client text;
  org record;
  member_versions text;
  unit_versions text;
  plan_versions text;
  subscription_version text;
  sub_plan text;
  pending_plan text;
BEGIN
  PERFORM set_config('app.user_id', p_user::text, true);
  SELECT s.client INTO selected_client
    FROM public.sessions s
    WHERE s.id = p_session AND s.user_id = p_user
      AND s.revoked_at IS NULL AND s.expires_at > statement_timestamp();
  IF NOT FOUND THEN RETURN; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_user AND u.deleted_at IS NULL
      AND u.status = 'ACTIVE' AND (u.email_verified_at IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM public.account_email_owners a WHERE a.user_id = p_user
      ))
  ) OR EXISTS (
    SELECT 1 FROM public.platform_role_assignments a
    WHERE a.user_id = p_user AND a.revoked_at IS NULL
  ) THEN
    RETURN QUERY SELECT selected_client, NULL::uuid, false, NULL::text, NULL::text, false, NULL::text;
    RETURN;
  END IF;

  SELECT m.organization_id INTO selected_org FROM public.organization_memberships m
    WHERE m.user_id = p_user AND m.status = 'ACTIVE' AND m.deleted_at IS NULL
    ORDER BY m.joined_at, m.id LIMIT 1;
  PERFORM set_config('app.organization_id', coalesce(selected_org::text, ''), true);
  -- Load only the tenant row and its MVCC version; no payload serialization.
  SELECT o.owner_user_id, o.status, o.deleted_at, o.data_purge_started_at,
         o.data_purged_at, o.plan_id, o.xmin::text AS version
    INTO org FROM public.organizations o WHERE o.id = selected_org;
  IF NOT FOUND THEN
    RETURN QUERY SELECT selected_client, NULL::uuid, false, NULL::text, NULL::text, false, NULL::text;
    RETURN;
  END IF;

  SELECT string_agg(concat(m.id, '/', m.xmin, '/', r.xmin), ',' ORDER BY m.id)
    INTO member_versions FROM public.organization_memberships m
    LEFT JOIN public.roles r ON r.id = m.role_id AND r.deleted_at IS NULL
    WHERE m.user_id = p_user AND m.status = 'ACTIVE' AND m.deleted_at IS NULL;
  IF org.owner_user_id = p_user THEN
    SELECT string_agg(concat(b.id, '/', b.xmin), ',' ORDER BY b.is_primary DESC, b.created_at, b.id)
      INTO unit_versions FROM public.business_units b
      WHERE b.organization_id = selected_org AND b.status = 'ACTIVE' AND b.deleted_at IS NULL;
  ELSE
    SELECT string_agg(concat(m.id, '/', m.xmin), ',' ORDER BY m.id)
      INTO unit_versions FROM public.business_unit_memberships m
      WHERE m.organization_id = selected_org AND m.user_id = p_user
        AND m.status = 'ACTIVE' AND m.deleted_at IS NULL;
  END IF;

  SELECT concat(s.id, '/', s.xmin), s.plan_code, s.pending_plan_code
    INTO subscription_version, sub_plan, pending_plan FROM public.organization_subscriptions s
    WHERE s.organization_id = selected_org
    ORDER BY s.ended_at DESC NULLS FIRST, s.started_at DESC, s.id DESC LIMIT 1;
  SELECT string_agg(concat(p.id, '/', p.xmin), ',' ORDER BY p.id)
    INTO plan_versions FROM public.plans p
    WHERE p.id = org.plan_id OR p.key IN (sub_plan, pending_plan);

  RETURN QUERY SELECT selected_client, selected_org, true,
    encode(sha256(convert_to(concat_ws('|', org.owner_user_id, coalesce(member_versions, ''), coalesce(unit_versions, '')), 'UTF8')), 'hex'),
    CASE WHEN org.deleted_at IS NULL THEN org.status::text ELSE 'UNAVAILABLE' END,
    org.deleted_at IS NULL AND org.status IN ('ACTIVE','ONBOARDING')
      AND org.data_purge_started_at IS NULL AND org.data_purged_at IS NULL,
    encode(sha256(convert_to(concat_ws('|', org.version, coalesce(subscription_version, ''), coalesce(plan_versions, '')), 'UTF8')), 'hex');
END;
$$;

REVOKE ALL ON FUNCTION public.app_hotpath_access(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_hotpath_access(uuid, uuid) TO orbit_app;
