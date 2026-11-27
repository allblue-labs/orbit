BEGIN;
SET LOCAL lock_timeout = '5s';

-- Historical commercial attribution is optional and never backfilled from
-- the tenant's current plan. Canonical invoice values stay unchanged.
ALTER TABLE public.billing_invoices ADD COLUMN plan_code_at_issue varchar(60);
CREATE INDEX billing_invoices_finance_period
  ON public.billing_invoices (mode, currency, (coalesce(finalized_at, provider_created_at)), id)
  WHERE provider = 'STRIPE';

CREATE FUNCTION public.app_corporate_finance_scope(p_organization uuid, p_mode text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT nullif(current_setting('app.corporate_finance_principal', true), '')::uuid IS NOT NULL
    AND public.app_current_organization_id() IS NULL
    AND nullif(current_setting('app.corporate_finance_mode', true), '') IN ('TEST', 'LIVE')
    AND (p_mode IS NULL OR p_mode = nullif(current_setting('app.corporate_finance_mode', true), ''))
    AND (nullif(current_setting('app.corporate_finance_organization', true), '') IS NULL
      OR p_organization = nullif(current_setting('app.corporate_finance_organization', true), '')::uuid)
$$;
REVOKE ALL ON FUNCTION public.app_corporate_finance_scope(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_corporate_finance_scope(uuid, text) TO orbit_app;

CREATE POLICY corporate_finance_invoice_read ON public.billing_invoices FOR SELECT TO orbit_app
  USING (provider = 'STRIPE' AND public.app_corporate_finance_scope(organization_id, mode));
-- Related records inherit their Stripe mode through the composite invoice
-- binding in each query. Tenant scope also applies at the row-policy boundary.
CREATE POLICY corporate_finance_adjustment_read ON public.billing_financial_adjustments FOR SELECT TO orbit_app
  USING (provider = 'STRIPE' AND public.app_corporate_finance_scope(organization_id, NULL)
    AND EXISTS (
      SELECT 1 FROM public.billing_invoices i
      WHERE i.id = billing_invoice_id AND i.organization_id = billing_financial_adjustments.organization_id
        AND public.app_corporate_finance_scope(i.organization_id, i.mode)
    ));
CREATE POLICY corporate_finance_transition_read ON public.billing_invoice_transitions FOR SELECT TO orbit_app
  USING (provider = 'STRIPE' AND source_event_type = 'invoice.payment_failed'
    AND public.app_corporate_finance_scope(organization_id, NULL)
    AND EXISTS (
      SELECT 1 FROM public.billing_invoices i
      WHERE i.id = billing_invoice_id AND i.organization_id = billing_invoice_transitions.organization_id
        AND public.app_corporate_finance_scope(i.organization_id, i.mode)
    ));
CREATE POLICY corporate_finance_customer_read ON public.billing_customers FOR SELECT TO orbit_app
  USING (provider = 'STRIPE' AND public.app_corporate_finance_scope(organization_id, mode)
    AND organization_id = nullif(current_setting('app.corporate_finance_organization', true), '')::uuid);
CREATE POLICY corporate_finance_subscription_read ON public.organization_subscriptions FOR SELECT TO orbit_app
  USING (public.app_corporate_finance_scope(organization_id, NULL)
    AND organization_id = nullif(current_setting('app.corporate_finance_organization', true), '')::uuid);
CREATE POLICY corporate_finance_organization_read ON public.organizations FOR SELECT TO orbit_app
  USING (deleted_at IS NULL AND public.app_corporate_finance_scope(id, NULL)
    AND id = nullif(current_setting('app.corporate_finance_organization', true), '')::uuid);
CREATE POLICY corporate_finance_audit ON public.audit_logs FOR INSERT TO orbit_app
  WITH CHECK (organization_id IS NULL AND business_unit_id IS NULL AND user_id IS NULL
    AND entity_type = 'SAAS_FINANCE' AND action = 'CORPORATE_FINANCE_READ'
    AND metadata->>'technicalPrincipalId'
      = nullif(current_setting('app.corporate_finance_principal', true), '')::uuid::text);

COMMIT;
