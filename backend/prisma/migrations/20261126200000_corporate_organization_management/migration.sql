BEGIN;

-- The request role never becomes a platform admin. Only these parameterized
-- routines run with the directory role, which is subject to its own RLS policies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orbit_corporate_directory') THEN
    CREATE ROLE orbit_corporate_directory NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname = 'orbit_corporate_directory'
      AND (r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolbypassrls
        OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication
        OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid = r.oid OR m.member = r.oid))
  ) THEN
    RAISE EXCEPTION 'Unexpected privileges on orbit_corporate_directory';
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO orbit_corporate_directory;
GRANT SELECT (id, owner_user_id, display_name, primary_segment, status, created_at, updated_at, deleted_at,
  data_purge_started_at, data_purged_at)
  ON public.organizations TO orbit_corporate_directory;
GRANT UPDATE (display_name, primary_segment, updated_at)
  ON public.organizations TO orbit_corporate_directory;
GRANT SELECT (id, organization_id, is_primary, legal_name, trade_name, document_type, document_number,
  email, phone, status, city, state_code, created_at, deleted_at)
  ON public.business_units TO orbit_corporate_directory;
GRANT SELECT (id, display_name, deleted_at) ON public.users TO orbit_corporate_directory;
-- user_id is also required by the existing users_roster RLS subquery.
GRANT SELECT (organization_id, user_id, status, deleted_at)
  ON public.organization_memberships TO orbit_corporate_directory;
GRANT SELECT (organization_id, document_number)
  ON public.account_document_registrations TO orbit_corporate_directory;
GRANT SELECT (id, organization_id, plan_code, status, billing_interval, started_at, ended_at,
  billing_anchor_at, current_period_start, current_period_end, trial_starts_at, trial_ends_at,
  grace_starts_at, grace_ends_at, cancel_at_period_end, pending_effective_at, pending_plan_code,
  pending_billing_interval, provider_subscription_id, version)
  ON public.organization_subscriptions TO orbit_corporate_directory;
GRANT INSERT (id, organization_id, action, entity_type, entity_id, request_id, metadata)
  ON public.audit_logs TO orbit_corporate_directory;

CREATE POLICY corporate_directory_read ON public.organizations
  FOR SELECT TO orbit_corporate_directory USING (deleted_at IS NULL);
CREATE POLICY corporate_directory_update ON public.organizations
  FOR UPDATE TO orbit_corporate_directory USING (deleted_at IS NULL) WITH CHECK (deleted_at IS NULL);
CREATE POLICY corporate_directory_read ON public.business_units
  FOR SELECT TO orbit_corporate_directory USING (deleted_at IS NULL);
CREATE POLICY corporate_directory_read ON public.users
  FOR SELECT TO orbit_corporate_directory USING (deleted_at IS NULL);
CREATE POLICY corporate_directory_read ON public.organization_memberships
  FOR SELECT TO orbit_corporate_directory USING (deleted_at IS NULL);
CREATE POLICY corporate_directory_read ON public.account_document_registrations
  FOR SELECT TO orbit_corporate_directory USING (true);
CREATE POLICY corporate_directory_read ON public.organization_subscriptions
  FOR SELECT TO orbit_corporate_directory USING (true);
CREATE POLICY corporate_directory_audit ON public.audit_logs
  FOR INSERT TO orbit_corporate_directory WITH CHECK (
    user_id IS NULL AND business_unit_id IS NULL AND entity_type = 'ORGANIZATION'
    AND action IN ('CORPORATE_ORGANIZATIONS_LISTED', 'CORPORATE_ORGANIZATION_READ', 'CORPORATE_ORGANIZATION_UPDATED')
  );

-- The existing business_units policy calls this predicate from runtimes with
-- different search paths. Keep its behavior and make its references explicit.
CREATE OR REPLACE FUNCTION public.app_is_organization_owner()
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = public.app_current_organization_id()
      AND owner_user_id = public.app_current_user_id()
      AND deleted_at IS NULL
  )
$$;

-- PostgreSQL checks ACLs for policy subqueries even when another SELECT policy
-- admits the row. Run the existing relationship checks only for portal actors,
-- with their own table grants and RLS, so the directory cannot read field data.
CREATE FUNCTION public.app_portal_business_unit_is_related(p_unit uuid, p_organization uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  customer uuid;
BEGIN
  IF public.app_current_actor_type() IS DISTINCT FROM 'CUSTOMER_PORTAL'
    OR p_organization IS DISTINCT FROM public.app_current_organization_id()
    OR public.app_current_portal_identity_id() IS NULL THEN
    RETURN false;
  END IF;
  customer := public.app_current_customer_id();
  RETURN EXISTS (
    SELECT 1 FROM public.operations o WHERE o.business_unit_id = p_unit AND o.customer_id = customer AND o.deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM public.assets a WHERE a.business_unit_id = p_unit AND a.customer_id = customer AND a.deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM public.pmoc_plans p WHERE p.business_unit_id = p_unit AND p.customer_id = customer AND p.deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM public.rvt_configurations r WHERE r.business_unit_id = p_unit AND r.customer_id = customer AND r.deleted_at IS NULL
    UNION ALL
    SELECT 1 FROM public.artifact_executions e WHERE e.business_unit_id = p_unit AND e.customer_id = customer AND e.deleted_at IS NULL
  );
END
$$;
ALTER POLICY business_units_portal_related_read ON public.business_units
  USING (public.app_portal_business_unit_is_related(id, organization_id));

-- Shared with the existing platform administration repository. The invoker's
-- existing table permissions and RLS apply, including on human admin requests.
CREATE FUNCTION public.app_platform_canonical_subscription_id(p_organization uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.id FROM public.organization_subscriptions s
  WHERE s.organization_id = p_organization
  ORDER BY (s.ended_at IS NULL) DESC, s.started_at DESC, s.id DESC
  LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.app_platform_canonical_subscription_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_platform_canonical_subscription_id(uuid) TO orbit_app, orbit_corporate_directory;

CREATE FUNCTION public.app_corporate_read_organizations(
  p_id uuid, p_filters jsonb, p_principal uuid, p_administrator uuid, p_correlation text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  result jsonb;
  found_id uuid;
  lookup_id uuid := (p_filters->>'lookupId')::uuid;
  registered_from timestamptz := (p_filters->>'registeredFrom')::timestamptz;
  registered_before timestamptz := (p_filters->>'registeredBefore')::timestamptz;
  page_number int := LEAST(10000, GREATEST(1, COALESCE((p_filters->>'page')::int, 1)));
  page_size int := LEAST(100, GREATEST(1, COALESCE((p_filters->>'pageSize')::int, 25)));
BEGIN
  -- Apply caller filters once so the total and page share the same snapshot.
  -- Contacts, owner details and counts are read after pagination.
  WITH matching AS MATERIALIZED (
    SELECT o.id, o.display_name, o.created_at
    FROM public.organizations o
    LEFT JOIN LATERAL (
      SELECT bu.legal_name, bu.trade_name, bu.document_number
      FROM public.business_units bu
      WHERE bu.organization_id = o.id AND bu.is_primary AND bu.deleted_at IS NULL
        AND (p_filters->>'q' IS NOT NULL OR p_filters->>'document' IS NOT NULL)
      ORDER BY bu.created_at, bu.id LIMIT 1
    ) u ON true
    LEFT JOIN public.organization_subscriptions s ON s.id = CASE
      WHEN p_filters->>'planCode' IS NOT NULL OR p_filters->>'subscriptionStatus' IS NOT NULL
      THEN public.app_platform_canonical_subscription_id(o.id) END
    WHERE o.deleted_at IS NULL AND (p_id IS NULL OR o.id = p_id)
      AND (lookup_id IS NULL OR o.id = lookup_id)
      AND (p_filters->>'q' IS NULL OR strpos(lower(o.display_name), lower(p_filters->>'q')) > 0
        OR strpos(lower(u.legal_name), lower(p_filters->>'q')) > 0
        OR strpos(lower(u.trade_name), lower(p_filters->>'q')) > 0)
      AND (p_filters->>'document' IS NULL
        OR regexp_replace(u.document_number, '[^0-9]', '', 'g') = p_filters->>'document'
        OR EXISTS (SELECT 1 FROM public.account_document_registrations r
          WHERE r.document_number = p_filters->>'document' AND r.organization_id = o.id))
      AND (p_filters->>'operationalStatus' IS NULL OR o.status = p_filters->>'operationalStatus')
      AND (p_filters->>'planCode' IS NULL OR s.plan_code = p_filters->>'planCode')
      AND (p_filters->>'subscriptionStatus' IS NULL
        OR COALESCE(s.status, 'UNKNOWN') = p_filters->>'subscriptionStatus')
      AND (registered_from IS NULL OR o.created_at >= registered_from)
      AND (registered_before IS NULL OR o.created_at < registered_before)
  ), page AS (
    SELECT m.*, row_number() OVER (ORDER BY
      CASE WHEN p_filters->>'sort' = 'displayName' AND p_filters->>'direction' = 'asc' THEN lower(m.display_name) END,
      CASE WHEN p_filters->>'sort' = 'displayName' AND p_filters->>'direction' = 'desc' THEN lower(m.display_name) END DESC,
      CASE WHEN p_filters->>'sort' = 'registeredAt' AND p_filters->>'direction' = 'asc' THEN m.created_at END,
      CASE WHEN p_filters->>'sort' IS DISTINCT FROM 'displayName'
        AND p_filters->>'direction' IS DISTINCT FROM 'asc' THEN m.created_at END DESC,
      m.id) AS position
    FROM matching m
    ORDER BY position
    LIMIT CASE WHEN p_id IS NULL THEN page_size ELSE 1 END
    OFFSET CASE WHEN p_id IS NULL THEN (page_number - 1) * page_size ELSE 0 END
  ), items AS (
    SELECT p.position, o.id, jsonb_build_object(
      'id', o.id, 'displayName', o.display_name, 'legalName', u.legal_name, 'tradeName', u.trade_name,
      'document', CASE WHEN u.id IS NOT NULL THEN jsonb_build_object('type', u.document_type, 'number', u.document_number)
        WHEN r.document_number IS NOT NULL THEN jsonb_build_object(
          'type', CASE length(r.document_number) WHEN 11 THEN 'CPF' WHEN 14 THEN 'CNPJ' END,
          'number', r.document_number) END,
      'primarySegment', o.primary_segment, 'operationalStatus', o.status,
      'purgeBlocked', o.data_purge_started_at IS NOT NULL OR o.data_purged_at IS NOT NULL,
      'registeredAt', to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'updatedAt', to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'unitCount', (SELECT count(*) FROM public.business_units bu WHERE bu.organization_id = o.id AND bu.deleted_at IS NULL),
      'userCount', members.total,
      'subscription', CASE WHEN s.id IS NOT NULL THEN jsonb_build_object(
        'id', s.id, 'status', s.status, 'planCode', s.plan_code, 'billingInterval', s.billing_interval,
        'billingAnchorAt', s.billing_anchor_at, 'currentPeriodStart', s.current_period_start,
        'currentPeriodEnd', s.current_period_end, 'trialStartsAt', s.trial_starts_at, 'trialEndsAt', s.trial_ends_at,
        'graceStartsAt', s.grace_starts_at, 'graceEndsAt', s.grace_ends_at, 'pendingEffectiveAt', s.pending_effective_at,
        'pendingPlanCode', s.pending_plan_code, 'pendingBillingInterval', s.pending_billing_interval,
        'providerManaged', s.provider_subscription_id IS NOT NULL,
        'cancelAtPeriodEnd', s.cancel_at_period_end, 'version', s.version) END
    ) || CASE WHEN p_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
      'administrativeContact', CASE WHEN u.email IS NOT NULL OR u.phone IS NOT NULL
        THEN jsonb_build_object('email', u.email, 'phone', u.phone) END,
      'owner', CASE WHEN owner.id IS NOT NULL THEN jsonb_build_object('id', owner.id, 'displayName', owner.display_name) END,
      'activeUserCount', members.active, 'units', units.data
    ) END AS data
    FROM page p
    JOIN public.organizations o ON o.id = p.id
    LEFT JOIN LATERAL (
      SELECT bu.id, bu.legal_name, bu.trade_name, bu.document_type, bu.document_number, bu.email, bu.phone
      FROM public.business_units bu
      WHERE bu.organization_id = o.id AND bu.is_primary AND bu.deleted_at IS NULL
      ORDER BY bu.created_at, bu.id LIMIT 1
    ) u ON true
    LEFT JOIN public.organization_subscriptions s ON s.id = public.app_platform_canonical_subscription_id(o.id)
    LEFT JOIN public.users owner ON p_id IS NOT NULL AND owner.id = o.owner_user_id AND owner.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT document_number FROM public.account_document_registrations
      WHERE organization_id = o.id AND u.id IS NULL ORDER BY document_number LIMIT 1
    ) r ON true
    CROSS JOIN LATERAL (
      SELECT count(*) AS total, count(*) FILTER (WHERE status = 'ACTIVE') AS active
      FROM public.organization_memberships m WHERE m.organization_id = o.id AND m.deleted_at IS NULL
    ) members
    CROSS JOIN LATERAL (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', b.id, 'legalName', b.legal_name, 'tradeName', b.trade_name, 'isPrimary', b.is_primary,
        'status', b.status, 'city', b.city, 'stateCode', b.state_code
      ) ORDER BY b.is_primary DESC, b.created_at, b.id), '[]'::jsonb) AS data
      FROM (
        SELECT bu.id, bu.legal_name, bu.trade_name, bu.is_primary, bu.status, bu.city, bu.state_code, bu.created_at
        FROM public.business_units bu WHERE p_id IS NOT NULL AND bu.organization_id = o.id AND bu.deleted_at IS NULL
        ORDER BY bu.is_primary DESC, bu.created_at, bu.id LIMIT 100
      ) b
    ) units
  )
  SELECT CASE WHEN p_id IS NOT NULL THEN (SELECT data FROM items)
    ELSE jsonb_build_object('items', COALESCE((SELECT jsonb_agg(data ORDER BY position) FROM items), '[]'::jsonb),
      'total', (SELECT count(*) FROM matching), 'page', page_number, 'pageSize', page_size) END,
    CASE WHEN p_id IS NOT NULL THEN (SELECT id FROM items) END
  INTO result, found_id;

  INSERT INTO public.audit_logs(id, organization_id, action, entity_type, entity_id, request_id, metadata)
  VALUES (gen_random_uuid(), found_id,
    CASE WHEN p_id IS NULL THEN 'CORPORATE_ORGANIZATIONS_LISTED' ELSE 'CORPORATE_ORGANIZATION_READ' END,
    'ORGANIZATION', p_id, p_correlation,
    jsonb_strip_nulls(jsonb_build_object('technicalPrincipalId', p_principal,
      'declaredNexusAdministratorId', p_administrator,
      'result', CASE WHEN result IS NULL THEN 'NOT_FOUND' ELSE 'CONFIRMED' END)));
  RETURN result;
END
$$;

CREATE FUNCTION public.app_corporate_update_organization(
  p_id uuid, p_expected timestamptz, p_name text, p_segment text,
  p_principal uuid, p_administrator uuid, p_correlation text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  existing record;
  new_version timestamptz;
  fields text[] := ARRAY[]::text[];
  outcome text;
BEGIN
  IF p_expected IS NULL OR p_administrator IS NULL OR p_principal IS NULL
    OR (p_name IS NULL AND p_segment IS NULL)
    OR (p_name IS NOT NULL AND char_length(p_name) NOT BETWEEN 2 AND 180)
    OR (p_segment IS NOT NULL AND char_length(p_segment) NOT BETWEEN 2 AND 60) THEN
    RAISE EXCEPTION 'Invalid corporate metadata change' USING ERRCODE = '22023';
  END IF;
  -- Serialize with operational/human writers before comparing the existing
  -- updated_at version. Only the two shared administration fields are writable.
  SELECT id, display_name, primary_segment, updated_at INTO existing
  FROM public.organizations WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    outcome := 'NOT_FOUND';
  ELSIF existing.updated_at <> p_expected THEN
    outcome := 'VERSION_CONFLICT';
  ELSE
    IF p_name IS DISTINCT FROM existing.display_name AND p_name IS NOT NULL THEN
      fields := array_append(fields, 'displayName');
    END IF;
    IF p_segment IS DISTINCT FROM existing.primary_segment AND p_segment IS NOT NULL THEN
      fields := array_append(fields, 'primarySegment');
    END IF;
    new_version := existing.updated_at;
    outcome := 'NO_CHANGE';
    IF cardinality(fields) > 0 THEN
      UPDATE public.organizations
      SET display_name = COALESCE(p_name, display_name), primary_segment = COALESCE(p_segment, primary_segment),
        updated_at = greatest(clock_timestamp()::timestamptz(3), updated_at + interval '1 millisecond')
      WHERE id = p_id RETURNING updated_at INTO STRICT new_version;
      outcome := 'CONFIRMED';
    END IF;
  END IF;

  INSERT INTO public.audit_logs(id, organization_id, action, entity_type, entity_id, request_id, metadata)
  VALUES (gen_random_uuid(), existing.id, 'CORPORATE_ORGANIZATION_UPDATED', 'ORGANIZATION', p_id, p_correlation,
    jsonb_build_object('technicalPrincipalId', p_principal, 'declaredNexusAdministratorId', p_administrator,
      'changedFields', fields, 'result', outcome));
  RETURN jsonb_build_object('result', outcome, 'changedFields', fields,
    'updatedAt', to_char(new_version AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
END
$$;

ALTER FUNCTION public.app_corporate_read_organizations(uuid, jsonb, uuid, uuid, text) OWNER TO orbit_corporate_directory;
ALTER FUNCTION public.app_corporate_update_organization(uuid, timestamptz, text, text, uuid, uuid, text) OWNER TO orbit_corporate_directory;
REVOKE EXECUTE ON FUNCTION public.app_corporate_read_organizations(uuid, jsonb, uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.app_corporate_update_organization(uuid, timestamptz, text, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_corporate_read_organizations(uuid, jsonb, uuid, uuid, text) TO orbit_app;
GRANT EXECUTE ON FUNCTION public.app_corporate_update_organization(uuid, timestamptz, text, text, uuid, uuid, text) TO orbit_app;

COMMIT;
