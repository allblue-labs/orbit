CREATE TABLE billing_plan_upgrades (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  subscription_id UUID NOT NULL,
  subscription_version INTEGER NOT NULL,
  requested_by UUID,
  previous_period_start TIMESTAMPTZ(3) NOT NULL,
  previous_period_end TIMESTAMPTZ(3) NOT NULL,
  price_id VARCHAR(255) NOT NULL,
  catalog_version INTEGER NOT NULL,
  entitlements JSONB NOT NULL,
  invoice_id VARCHAR(255) CONSTRAINT billing_plan_upgrades_invoice_unique UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'APPLIED', 'EXPIRED')),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id, organization_id)
    REFERENCES organization_subscriptions(id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX billing_plan_upgrades_pending ON billing_plan_upgrades (subscription_id) WHERE status = 'OPEN';
CREATE INDEX billing_plan_upgrades_org ON billing_plan_upgrades (organization_id);

CREATE TABLE billing_support_tickets (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  subscription_id UUID NOT NULL,
  requested_by UUID,
  kind VARCHAR(30) NOT NULL CHECK (kind IN ('PLAN_CHANGE', 'CANCELLATION', 'REFUND_REVIEW')),
  target_plan_code VARCHAR(60),
  target_interval VARCHAR(20),
  reference VARCHAR(255) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
  resolved_by UUID,
  resolved_at TIMESTAMPTZ(3),
  resolution TEXT,
  email_sent_at TIMESTAMPTZ(3),
  email_attempts INTEGER NOT NULL DEFAULT 0,
  next_email_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id, organization_id)
    REFERENCES organization_subscriptions(id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX billing_support_tickets_open ON billing_support_tickets
  (subscription_id, kind, reference) WHERE status = 'OPEN';
CREATE INDEX billing_support_tickets_org ON billing_support_tickets (organization_id);
CREATE INDEX billing_support_tickets_queue ON billing_support_tickets (status, id DESC);
CREATE INDEX billing_support_tickets_email ON billing_support_tickets (next_email_at) WHERE email_sent_at IS NULL;

CREATE TABLE billing_refund_requests (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  subscription_id UUID NOT NULL,
  requested_by UUID,
  invoice_id VARCHAR(255) NOT NULL UNIQUE,
  payment_intent_id VARCHAR(255) NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  refund_id VARCHAR(255),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'REVIEW')),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (subscription_id, organization_id)
    REFERENCES organization_subscriptions(id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX billing_refund_requests_subscription ON billing_refund_requests (subscription_id);
CREATE INDEX billing_refund_requests_work ON billing_refund_requests (next_attempt_at) WHERE status = 'OPEN';

ALTER TABLE billing_plan_upgrades ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_plan_upgrades FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_support_tickets FORCE ROW LEVEL SECURITY;
ALTER TABLE billing_refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_refund_requests FORCE ROW LEVEL SECURITY;

CREATE POLICY billing_plan_upgrades_tenant ON billing_plan_upgrades
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());
CREATE POLICY billing_support_tickets_tenant ON billing_support_tickets
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());
CREATE POLICY billing_refund_requests_tenant ON billing_refund_requests
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE ON
  billing_plan_upgrades, billing_support_tickets, billing_refund_requests TO orbit_app;
