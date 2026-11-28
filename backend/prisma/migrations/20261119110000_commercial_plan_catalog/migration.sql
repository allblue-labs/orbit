ALTER TABLE plans
    ADD COLUMN commercial JSONB,
    ADD COLUMN catalog_version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN catalog_tenant_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE plans ADD CONSTRAINT plans_catalog_version_positive CHECK (catalog_version > 0);
CREATE INDEX plans_catalog_tenant_id_idx ON plans (catalog_tenant_id);

CREATE TABLE plan_stripe_prices (
    id VARCHAR(255) PRIMARY KEY,
    plan_code VARCHAR(40) NOT NULL REFERENCES plans(key) ON DELETE CASCADE,
    billing_interval VARCHAR(20) NOT NULL CHECK (billing_interval IN ('MONTHLY','SEMIANNUAL','ANNUAL')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0)
);
CREATE INDEX plan_stripe_prices_plan_code_idx ON plan_stripe_prices (plan_code);
ALTER TABLE plan_stripe_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_stripe_prices FORCE ROW LEVEL SECURITY;
CREATE POLICY plan_stripe_prices_read ON plan_stripe_prices FOR SELECT USING (true);
CREATE POLICY plan_stripe_prices_platform ON plan_stripe_prices FOR ALL
    USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

ALTER TABLE billing_checkout_attempts
    ADD COLUMN quoted_price_id VARCHAR(255),
    ADD COLUMN quoted_catalog_version INTEGER,
    ADD COLUMN quoted_entitlements JSONB;
ALTER TABLE billing_checkout_attempts ADD CONSTRAINT billing_checkout_attempts_quote_complete
    CHECK (num_nonnulls(quoted_price_id, quoted_catalog_version, quoted_entitlements) IN (0, 3));

-- Preserve authorization on contracts issued before the offers moved to the database.
UPDATE organization_subscriptions AS s
SET entitlements_snapshot = s.entitlements_snapshot ||
    jsonb_build_object('label', p.name, 'routeCapabilities', p.capabilities)
FROM plans AS p
WHERE p.key = s.plan_code AND jsonb_typeof(s.entitlements_snapshot) = 'object'
    AND NOT (s.entitlements_snapshot ? 'routeCapabilities');

UPDATE organization_subscriptions AS s
SET pending_entitlements_snapshot = s.pending_entitlements_snapshot ||
    jsonb_build_object('label', p.name, 'routeCapabilities', p.capabilities)
FROM plans AS p
WHERE p.key = s.pending_plan_code AND jsonb_typeof(s.pending_entitlements_snapshot) = 'object'
    AND NOT (s.pending_entitlements_snapshot ? 'routeCapabilities');
