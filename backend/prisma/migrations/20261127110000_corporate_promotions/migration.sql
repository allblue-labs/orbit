BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.billing_promotions (
  id uuid PRIMARY KEY,
  code varchar(32) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{2,31}$'),
  name varchar(120) NOT NULL,
  description varchar(500),
  percent_off integer,
  amount_off_minor integer,
  currency varchar(3),
  starts_at timestamptz(3) NOT NULL,
  ends_at timestamptz(3) NOT NULL,
  plan_codes text[] NOT NULL,
  billing_intervals text[] NOT NULL,
  total_limit integer NOT NULL CHECK (total_limit BETWEEN 1 AND 1000000),
  customer_limit integer NOT NULL CHECK (customer_limit BETWEEN 1 AND total_limit),
  audience varchar(20) NOT NULL CHECK (audience IN ('ANY','NEW_CUSTOMER','EXISTING_CUSTOMER')),
  duration_months integer CHECK (duration_months BETWEEN 2 AND 12),
  status varchar(20) NOT NULL CHECK (status IN ('DRAFT','ACTIVATING','ACTIVE','DEACTIVATING','INACTIVE')),
  mode varchar(10) CHECK (mode IN ('TEST','LIVE')),
  eligible_prices jsonb,
  provider_promotion_id varchar(255),
  sync_started_at timestamptz(3),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT billing_promotion_discount CHECK (
    (percent_off IS NOT NULL AND percent_off BETWEEN 1 AND 99 AND amount_off_minor IS NULL AND currency IS NULL)
    OR (percent_off IS NULL AND amount_off_minor IS NOT NULL AND amount_off_minor > 0 AND currency IS NOT NULL AND currency = 'BRL')
  ),
  CHECK (starts_at < ends_at),
  CHECK (cardinality(plan_codes) BETWEEN 1 AND 25),
  CHECK (cardinality(billing_intervals) BETWEEN 1 AND 3 AND billing_intervals <@ ARRAY['MONTHLY','SEMIANNUAL','ANNUAL']),
  CHECK (duration_months IS NULL OR billing_intervals = ARRAY['MONTHLY']),
  CHECK ((status = 'DRAFT') = (mode IS NULL)),
  CHECK (status NOT IN ('ACTIVE','DEACTIVATING','INACTIVE') OR provider_promotion_id IS NOT NULL),
  CHECK (status = 'DRAFT' OR (eligible_prices IS NOT NULL AND sync_started_at IS NOT NULL)),
  UNIQUE (mode, provider_promotion_id)
);
CREATE INDEX billing_promotions_status_created ON public.billing_promotions(status, created_at, id);

CREATE TABLE public.corporate_promotion_commands (
  id uuid PRIMARY KEY,
  technical_principal_id uuid NOT NULL,
  promotion_id uuid NOT NULL REFERENCES public.billing_promotions(id),
  operation varchar(12) NOT NULL CHECK (operation IN ('CREATE','UPDATE','ACTIVATE','DEACTIVATE')),
  key_hash char(64) NOT NULL,
  request_hash char(64) NOT NULL,
  result jsonb,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT corporate_promotion_command_key UNIQUE (technical_principal_id, operation, key_hash)
);
CREATE UNIQUE INDEX corporate_promotion_pending ON public.corporate_promotion_commands(promotion_id) WHERE result IS NULL;

ALTER TABLE public.billing_checkout_attempts
  ADD COLUMN promotion_id uuid REFERENCES public.billing_promotions(id),
  ADD COLUMN promotion_code varchar(32),
  ADD COLUMN provider_promotion_id varchar(255),
  ADD COLUMN promotion_original_minor integer,
  ADD COLUMN promotion_discount_minor integer,
  ADD COLUMN promotion_checkout_expires_at timestamptz(3),
  ADD CONSTRAINT billing_checkout_promotion_terms CHECK (
    (promotion_id IS NULL AND promotion_code IS NULL AND provider_promotion_id IS NULL
      AND promotion_original_minor IS NULL AND promotion_discount_minor IS NULL AND promotion_checkout_expires_at IS NULL)
    OR (promotion_id IS NOT NULL AND promotion_code IS NOT NULL AND provider_promotion_id IS NOT NULL
      AND promotion_original_minor IS NOT NULL AND promotion_original_minor > 0 AND promotion_checkout_expires_at IS NOT NULL
      AND ((status = 'COMPLETED' AND promotion_discount_minor IS NOT NULL AND promotion_discount_minor > 0
        AND promotion_discount_minor <= promotion_original_minor) OR (status <> 'COMPLETED' AND promotion_discount_minor IS NULL)))
  ) NOT VALID;
CREATE INDEX billing_checkout_promotion_history ON public.billing_checkout_attempts(promotion_id, created_at, id)
  WHERE promotion_id IS NOT NULL;
CREATE INDEX billing_checkout_promotion_capacity ON public.billing_checkout_attempts(promotion_id, organization_id)
  WHERE promotion_id IS NOT NULL AND status IN ('CREATING','OPEN','COMPLETED');

ALTER TABLE public.billing_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_promotions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_promotion_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_promotion_commands FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.billing_promotions, public.corporate_promotion_commands TO orbit_app;

CREATE FUNCTION public.app_promotion_principal() RETURNS uuid
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT nullif(current_setting('app.corporate_promotion_principal', true), '')::uuid
$$;
CREATE POLICY corporate_promotions_manage ON public.billing_promotions FOR ALL
  USING (public.app_promotion_principal() IS NOT NULL) WITH CHECK (public.app_promotion_principal() IS NOT NULL);
CREATE POLICY corporate_promotion_receipt_scope ON public.corporate_promotion_commands FOR ALL
  USING (technical_principal_id = public.app_promotion_principal())
  WITH CHECK (technical_principal_id = public.app_promotion_principal());
CREATE POLICY corporate_promotion_redemptions ON public.billing_checkout_attempts FOR SELECT
  USING (promotion_id IS NOT NULL AND public.app_promotion_principal() IS NOT NULL);
CREATE POLICY corporate_promotion_audit ON public.audit_logs FOR INSERT
  WITH CHECK (organization_id IS NULL AND business_unit_id IS NULL AND user_id IS NULL
    AND entity_type = 'BILLING_PROMOTION'
    AND action IN ('CORPORATE_PROMOTION_READ','CORPORATE_PROMOTION_ATTEMPT','CORPORATE_PROMOTION_RESULT')
    AND metadata->>'technicalPrincipalId' = public.app_promotion_principal()::text);

-- The definer can lock the campaign and count competing reservations. The
-- application role can invoke only the narrow function and cannot read totals.
CREATE POLICY promotion_reservation_lock ON public.billing_promotions FOR ALL
  USING (current_user <> session_user AND current_setting('app.promotion_reservation', true) = 'true');
CREATE POLICY promotion_reservation_count ON public.billing_checkout_attempts FOR SELECT
  USING (current_user <> session_user AND current_setting('app.promotion_reservation', true) = 'true' AND promotion_id IS NOT NULL);

CREATE FUNCTION public.app_reserve_billing_promotion(
  p_code text, p_mode text, p_plan text, p_interval text, p_price text
) RETURNS TABLE("promotionId" uuid, "providerPromotionId" text, "originalMinor" integer, "checkoutExpiresAt" timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET app.promotion_reservation = 'true'
AS $$
DECLARE
  campaign public.billing_promotions%ROWTYPE;
  tenant uuid := public.app_current_organization_id();
  at_time timestamptz;
  amount integer;
  checkout_expiry timestamptz;
  returning_customer boolean;
  usages bigint;
  customer_usages bigint;
BEGIN
  IF tenant IS NULL THEN RETURN; END IF;
  SELECT * INTO campaign FROM public.billing_promotions
    WHERE code = p_code AND mode = p_mode AND status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  at_time := clock_timestamp();
  IF campaign.starts_at > at_time THEN RETURN; END IF;
  checkout_expiry := date_trunc('second', least(campaign.ends_at, at_time + interval '1 hour'));
  IF checkout_expiry <= at_time + interval '31 minutes' THEN RETURN; END IF;
  SELECT (price->>'amountMinor')::integer INTO amount FROM jsonb_array_elements(campaign.eligible_prices) price
    WHERE price->>'planCode' = p_plan AND price->>'billingInterval' = p_interval AND price->>'priceId' = p_price;
  IF amount IS NULL THEN RETURN; END IF;

  SELECT EXISTS (SELECT 1 FROM public.organization_subscriptions
      WHERE organization_id = tenant AND (provider_subscription_id IS NOT NULL OR status = 'ACTIVE'))
    OR EXISTS (SELECT 1 FROM public.billing_invoice_transitions WHERE organization_id = tenant AND amount_paid_minor > 0)
    INTO returning_customer;
  IF (campaign.audience = 'NEW_CUSTOMER' AND returning_customer)
    OR (campaign.audience = 'EXISTING_CUSTOMER' AND NOT returning_customer) THEN RETURN; END IF;

  SELECT count(*), count(*) FILTER (WHERE organization_id = tenant) INTO usages, customer_usages
    FROM public.billing_checkout_attempts WHERE promotion_id = campaign.id AND status IN ('CREATING','OPEN','COMPLETED');
  IF usages >= campaign.total_limit OR customer_usages >= campaign.customer_limit THEN RETURN; END IF;
  RETURN QUERY SELECT campaign.id, campaign.provider_promotion_id::text, amount, checkout_expiry;
END
$$;
REVOKE ALL ON FUNCTION public.app_reserve_billing_promotion(text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_reserve_billing_promotion(text,text,text,text,text) TO orbit_app;

COMMIT;
