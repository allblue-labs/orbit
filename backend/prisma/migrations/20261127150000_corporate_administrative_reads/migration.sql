BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.app_corporate_completion_scope(p_scope text) RETURNS uuid
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN current_setting('app.corporate_completion_scope', true) = p_scope
    AND public.app_current_user_id() IS NULL AND public.app_current_organization_id() IS NULL
    AND NOT public.app_is_platform_admin()
    THEN nullif(current_setting('app.corporate_completion_principal', true), '')::uuid END
$$;
REVOKE ALL ON FUNCTION public.app_corporate_completion_scope(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_corporate_completion_scope(text) TO orbit_app;

CREATE POLICY corporate_completion_provisioning ON public.platform_tenant_provisionings FOR SELECT TO orbit_app
  USING (technical_principal_id = public.app_corporate_completion_scope('PROVISIONINGS')
    OR technical_principal_id = public.app_corporate_completion_scope('RECEIPTS'));
CREATE POLICY corporate_completion_commercial ON public.corporate_commercial_commands FOR SELECT TO orbit_app
  USING (technical_principal_id = public.app_corporate_completion_scope('RECEIPTS'));
CREATE POLICY corporate_completion_promotions ON public.corporate_promotion_commands FOR SELECT TO orbit_app
  USING (technical_principal_id = public.app_corporate_completion_scope('RECEIPTS'));
CREATE POLICY corporate_completion_support_requests ON public.corporate_support_requests FOR SELECT TO orbit_app
  USING (technical_principal_id = public.app_corporate_completion_scope('RECEIPTS'));
CREATE POLICY corporate_completion_support_interactions ON public.corporate_support_interactions FOR SELECT TO orbit_app
  USING (public.app_corporate_completion_scope('RECEIPTS') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.corporate_support_requests r
    WHERE r.technical_principal_id = public.app_corporate_completion_scope('RECEIPTS')
      AND r.receipt->>'interactionId' = corporate_support_interactions.id::text
  ));
CREATE POLICY corporate_completion_decisions ON public.audit_logs FOR SELECT TO orbit_app
  USING (action = 'TENANT_OPERATIONAL_STATUS_CHANGED' AND user_id IS NULL
    AND metadata->>'technicalPrincipalId' = public.app_corporate_completion_scope('RECEIPTS')::text);
CREATE POLICY corporate_completion_subscription_orgs ON public.organizations FOR SELECT TO orbit_app
  USING (deleted_at IS NULL AND public.app_corporate_completion_scope('SUBSCRIPTIONS') IS NOT NULL);
CREATE POLICY corporate_completion_subscriptions ON public.organization_subscriptions FOR SELECT TO orbit_app
  USING (public.app_corporate_completion_scope('SUBSCRIPTIONS') IS NOT NULL);
CREATE POLICY corporate_completion_provisioning_orgs ON public.organizations FOR SELECT TO orbit_app
  USING (deleted_at IS NULL AND EXISTS (
    SELECT 1 FROM public.platform_tenant_provisionings p WHERE p.organization_id = organizations.id
      AND p.technical_principal_id = public.app_corporate_completion_scope('PROVISIONINGS')
  ));
CREATE POLICY corporate_completion_audit ON public.audit_logs FOR INSERT TO orbit_app
  WITH CHECK (organization_id IS NULL AND business_unit_id IS NULL AND user_id IS NULL
    AND entity_type = 'CORPORATE_ADMINISTRATIVE_READ' AND action = 'CORPORATE_ADMINISTRATIVE_READ'
    AND metadata->>'technicalPrincipalId' = public.app_corporate_completion_scope(metadata->>'scope')::text
    AND metadata->>'scope' IN ('PROVISIONINGS','RECEIPTS','SUBSCRIPTIONS'));

CREATE INDEX corporate_completion_workflow_page ON public.platform_tenant_provisionings
  (technical_principal_id, created_at DESC, id DESC) WHERE technical_principal_id IS NOT NULL;
CREATE INDEX corporate_completion_command_page ON public.corporate_commercial_commands
  (organization_id, technical_principal_id, created_at DESC, id DESC);
CREATE INDEX corporate_completion_decision_page ON public.audit_logs
  (organization_id, (metadata->>'technicalPrincipalId'), created_at DESC, id DESC)
  WHERE action = 'TENANT_OPERATIONAL_STATUS_CHANGED' AND user_id IS NULL;
CREATE INDEX corporate_completion_support_receipt ON public.corporate_support_requests
  (technical_principal_id, (receipt->>'interactionId'));

ALTER TABLE public.corporate_commercial_commands ADD COLUMN origin_ticket_id uuid;
CREATE UNIQUE INDEX corporate_commercial_origin_ticket ON public.corporate_commercial_commands(origin_ticket_id)
  WHERE origin_ticket_id IS NOT NULL;
ALTER TABLE public.corporate_commercial_commands ADD CONSTRAINT corporate_commercial_origin_ticket_proof
  CHECK (origin_ticket_id IS NULL OR (operation = 'CHANGE_PLAN' AND result->>'result' = 'AWAITING_REVIEW'
    AND result->>'ticketId' = origin_ticket_id::text) IS TRUE);

CREATE POLICY corporate_completion_support_origin ON public.corporate_commercial_commands FOR SELECT TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['SUPPORT_READ'])
    AND technical_principal_id = public.app_corporate_support_principal() AND origin_ticket_id IS NOT NULL);
CREATE POLICY corporate_completion_finance_label ON public.organizations FOR SELECT TO orbit_app
  USING (deleted_at IS NULL AND public.app_corporate_finance_scope(id, NULL)
    AND current_setting('app.corporate_finance_labels', true) = 'true'
    AND EXISTS (SELECT 1 FROM public.billing_invoices i
      WHERE i.organization_id = organizations.id AND i.provider = 'STRIPE'
        AND public.app_corporate_finance_scope(i.organization_id, i.mode)));
CREATE POLICY corporate_completion_operation_label ON public.organizations FOR SELECT TO orbit_app
  USING (deleted_at IS NULL AND public.app_corporate_support_scope(ARRAY['OPERATIONS'])
    AND current_setting('app.corporate_operation_labels', true) = 'true'
    AND (EXISTS (SELECT 1 FROM public.platform_tenant_provisionings p WHERE p.organization_id = organizations.id)
      OR EXISTS (SELECT 1 FROM public.identity_email_deliveries d WHERE d.organization_id = organizations.id)));
CREATE POLICY corporate_completion_provisioning_history ON public.audit_logs FOR SELECT TO orbit_app
  USING (public.app_corporate_support_scope(ARRAY['OPERATIONS'])
    AND entity_type = 'PLATFORM_ADMINISTRATION' AND action = 'PLATFORM_TENANT_PROVISIONING'
    AND metadata->>'technicalPrincipalId' = public.app_corporate_support_principal()::text
    AND entity_id::text = current_setting('app.corporate_provisioning_history_id', true)
    AND EXISTS (SELECT 1 FROM public.platform_tenant_provisionings p WHERE p.id = audit_logs.entity_id
      AND p.technical_principal_id = public.app_corporate_support_principal()));
CREATE INDEX corporate_completion_workflow_audit ON public.audit_logs (entity_id, created_at DESC, id DESC)
  WHERE action = 'PLATFORM_TENANT_PROVISIONING' AND entity_type = 'PLATFORM_ADMINISTRATION';
COMMIT;
