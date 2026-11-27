BEGIN;
SET LOCAL lock_timeout = '5s';

-- Replaced by the fenced Stripe reconciliation. Empty for legacy contracts.
ALTER TABLE public.organization_subscriptions ADD COLUMN recurring_observation jsonb;
CREATE INDEX subscription_trial_grants_analytics_start
  ON public.subscription_trial_grants (starts_at, organization_id);
CREATE INDEX organization_subscriptions_analytics_ended
  ON public.organization_subscriptions (ended_at, organization_id)
  WHERE provider = 'STRIPE' AND status = 'CANCELED' AND ended_at IS NOT NULL;

CREATE FUNCTION public.app_corporate_analytics_scope(p_operations text[], p_mode text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT nullif(current_setting('app.corporate_analytics_principal', true), '')::uuid IS NOT NULL
    AND public.app_current_organization_id() IS NULL
    AND current_setting('app.corporate_analytics_operation', true) = ANY(p_operations)
    AND current_setting('app.corporate_analytics_mode', true) IN ('TEST','LIVE')
    AND (p_mode IS NULL OR p_mode = current_setting('app.corporate_analytics_mode', true))
$$;
REVOKE ALL ON FUNCTION public.app_corporate_analytics_scope(text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_corporate_analytics_scope(text[], text) TO orbit_app;

CREATE POLICY corporate_analytics_invoices ON public.billing_invoices FOR SELECT TO orbit_app
  USING (provider = 'STRIPE' AND public.app_corporate_analytics_scope(ARRAY['LIFECYCLE','TRIALS','DELINQUENCY'], mode));
CREATE POLICY corporate_analytics_customers ON public.billing_customers FOR SELECT TO orbit_app
  USING (provider = 'STRIPE' AND public.app_corporate_analytics_scope(ARRAY['REVENUE','LIFECYCLE'], mode));
CREATE POLICY corporate_analytics_subscriptions ON public.organization_subscriptions FOR SELECT TO orbit_app
  USING (provider = 'STRIPE' AND public.app_corporate_analytics_scope(ARRAY['REVENUE','LIFECYCLE'])
    AND EXISTS (SELECT 1 FROM public.billing_customers c
      WHERE c.organization_id = organization_subscriptions.organization_id
        AND c.provider = 'STRIPE' AND c.provider_customer_id = organization_subscriptions.provider_customer_id
        AND public.app_corporate_analytics_scope(ARRAY['REVENUE','LIFECYCLE'], c.mode)));
CREATE POLICY corporate_analytics_trials ON public.subscription_trial_grants FOR SELECT TO orbit_app
  USING (public.app_corporate_analytics_scope(ARRAY['TRIALS']));
CREATE POLICY corporate_analytics_audit ON public.audit_logs FOR INSERT TO orbit_app
  WITH CHECK (organization_id IS NULL AND business_unit_id IS NULL AND user_id IS NULL
    AND entity_type = 'SAAS_ANALYTICS' AND action = 'CORPORATE_ANALYTICS_READ'
    AND metadata->>'technicalPrincipalId' = nullif(current_setting('app.corporate_analytics_principal', true), '')::uuid::text
    AND metadata->>'operation' = current_setting('app.corporate_analytics_operation', true)
    AND metadata->>'mode' = current_setting('app.corporate_analytics_mode', true)
    AND metadata->>'outcome' = 'CONFIRMED'
    AND public.app_corporate_analytics_scope(ARRAY['REVENUE','LIFECYCLE','TRIALS','DELINQUENCY']));

COMMIT;
