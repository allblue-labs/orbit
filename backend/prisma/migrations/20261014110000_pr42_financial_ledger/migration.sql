-- PR-42 — projeção de faturas e razão financeiro append-only.

CREATE TABLE "billing_invoices" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "provider" VARCHAR(20) NOT NULL,
  "mode" VARCHAR(10) NOT NULL,
  "provider_invoice_id" VARCHAR(255) NOT NULL,
  "invoice_number" VARCHAR(120),
  "status" VARCHAR(30) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "subtotal_minor" INTEGER NOT NULL,
  "discount_minor" INTEGER NOT NULL,
  "tax_minor" INTEGER NOT NULL,
  "total_minor" INTEGER NOT NULL,
  "amount_due_minor" INTEGER NOT NULL,
  "amount_paid_minor" INTEGER NOT NULL,
  "amount_remaining_minor" INTEGER NOT NULL,
  "credit_notes_minor" INTEGER NOT NULL,
  "attempted" BOOLEAN NOT NULL,
  "attempt_count" INTEGER NOT NULL,
  "billing_reason" VARCHAR(60),
  "collection_method" VARCHAR(40) NOT NULL,
  "hosted_invoice_url" VARCHAR(2048),
  "invoice_pdf_url" VARCHAR(2048),
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "period_end" TIMESTAMPTZ(3) NOT NULL,
  "due_at" TIMESTAMPTZ(3),
  "next_payment_attempt_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "paid_at" TIMESTAMPTZ(3),
  "voided_at" TIMESTAMPTZ(3),
  "marked_uncollectible_at" TIMESTAMPTZ(3),
  "provider_created_at" TIMESTAMPTZ(3) NOT NULL,
  "provider_observed_at" TIMESTAMPTZ(3) NOT NULL,
  "last_provider_event_id" VARCHAR(255),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_invoices_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_invoices_subscription_tenant_fkey"
    FOREIGN KEY ("subscription_id", "organization_id")
    REFERENCES "organization_subscriptions"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_invoices_provider_valid" CHECK ("provider" IN ('STRIPE')),
  CONSTRAINT "billing_invoices_mode_valid" CHECK ("mode" IN ('TEST','LIVE')),
  CONSTRAINT "billing_invoices_status_valid"
    CHECK ("status" IN ('DRAFT','OPEN','PAID','VOID','UNCOLLECTIBLE','UNKNOWN')),
  CONSTRAINT "billing_invoices_currency_lowercase" CHECK ("currency" = lower("currency")),
  CONSTRAINT "billing_invoices_amounts_nonnegative" CHECK (
    "amount_due_minor" >= 0 AND "amount_paid_minor" >= 0
    AND "amount_remaining_minor" >= 0
    AND "credit_notes_minor" >= 0 AND "attempt_count" >= 0
  ),
  CONSTRAINT "billing_invoices_period_valid" CHECK ("period_start" <= "period_end")
);

CREATE UNIQUE INDEX "billing_invoices_tenant_identity"
  ON "billing_invoices" ("id", "organization_id");
CREATE UNIQUE INDEX "billing_invoices_provider_invoice_unique"
  ON "billing_invoices" ("provider", "provider_invoice_id");
CREATE INDEX "billing_invoices_org_created_idx"
  ON "billing_invoices" ("organization_id", "provider_created_at" DESC);
CREATE INDEX "billing_invoices_subscription_created_idx"
  ON "billing_invoices" ("subscription_id", "provider_created_at" DESC);

CREATE TABLE "billing_invoice_transitions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "billing_invoice_id" UUID NOT NULL,
  "provider" VARCHAR(20) NOT NULL,
  "provider_event_id" VARCHAR(255) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "total_minor" INTEGER NOT NULL,
  "amount_paid_minor" INTEGER NOT NULL,
  "amount_remaining_minor" INTEGER NOT NULL,
  "attempt_count" INTEGER NOT NULL,
  "observed_at" TIMESTAMPTZ(3) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_invoice_transitions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_invoice_transitions_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_invoice_transitions_invoice_tenant_fkey"
    FOREIGN KEY ("billing_invoice_id", "organization_id")
    REFERENCES "billing_invoices"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_invoice_transitions_provider_valid" CHECK ("provider" IN ('STRIPE')),
  CONSTRAINT "billing_invoice_transitions_status_valid"
    CHECK ("status" IN ('DRAFT','OPEN','PAID','VOID','UNCOLLECTIBLE','UNKNOWN')),
  CONSTRAINT "billing_invoice_transitions_amounts_nonnegative" CHECK (
    "amount_paid_minor" >= 0
    AND "amount_remaining_minor" >= 0 AND "attempt_count" >= 0
  )
);

CREATE UNIQUE INDEX "billing_invoice_transitions_provider_event_unique"
  ON "billing_invoice_transitions" ("provider", "provider_event_id");
CREATE INDEX "billing_invoice_transitions_org_created_idx"
  ON "billing_invoice_transitions" ("organization_id", "created_at" DESC);
CREATE INDEX "billing_invoice_transitions_invoice_created_idx"
  ON "billing_invoice_transitions" ("billing_invoice_id", "created_at");

ALTER TABLE "billing_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY "billing_invoices_tenant_isolation" ON "billing_invoices"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

ALTER TABLE "billing_invoice_transitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_invoice_transitions" FORCE ROW LEVEL SECURITY;
CREATE POLICY "billing_invoice_transitions_tenant_isolation" ON "billing_invoice_transitions"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "billing_invoices" TO orbit_app;
-- Append-only: runtime não possui UPDATE nem DELETE no razão histórico.
GRANT SELECT, INSERT ON TABLE "billing_invoice_transitions" TO orbit_app;

CREATE TABLE "billing_financial_adjustments" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "billing_invoice_id" UUID NOT NULL,
  "provider" VARCHAR(20) NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "provider_object_id" VARCHAR(255) NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "amount_minor" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "reason" VARCHAR(80),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "provider_observed_at" TIMESTAMPTZ(3) NOT NULL,
  "last_provider_event_id" VARCHAR(255) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "billing_financial_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_financial_adjustments_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_financial_adjustments_invoice_tenant_fkey"
    FOREIGN KEY ("billing_invoice_id", "organization_id")
    REFERENCES "billing_invoices"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_financial_adjustments_provider_valid" CHECK ("provider" IN ('STRIPE')),
  CONSTRAINT "billing_financial_adjustments_type_valid" CHECK ("type" IN ('REFUND','DISPUTE')),
  CONSTRAINT "billing_financial_adjustments_amount_nonnegative" CHECK ("amount_minor" >= 0),
  CONSTRAINT "billing_financial_adjustments_currency_lowercase" CHECK ("currency" = lower("currency"))
);

CREATE UNIQUE INDEX "billing_financial_adjustments_provider_object_unique"
  ON "billing_financial_adjustments" ("provider", "type", "provider_object_id");
CREATE INDEX "billing_financial_adjustments_org_occurred_idx"
  ON "billing_financial_adjustments" ("organization_id", "occurred_at" DESC);
CREATE INDEX "billing_financial_adjustments_invoice_occurred_idx"
  ON "billing_financial_adjustments" ("billing_invoice_id", "occurred_at");

ALTER TABLE "billing_financial_adjustments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_financial_adjustments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "billing_financial_adjustments_tenant_isolation"
  ON "billing_financial_adjustments"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "billing_financial_adjustments" TO orbit_app;
