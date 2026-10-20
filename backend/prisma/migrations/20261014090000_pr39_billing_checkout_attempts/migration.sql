-- PR-39 — intenção durável para a primeira contratação.
--
-- A linha nasce antes da chamada ao Stripe. Ela é a correlação server-owned
-- entre organização, assinatura local, Customer e Checkout Session.

-- Identidades compostas usadas pelas FKs tenant-safe abaixo. O `id` já é
-- único; repetir a organização aqui faz o banco recusar um vínculo cruzado.
CREATE UNIQUE INDEX "organization_subscriptions_tenant_identity"
  ON "organization_subscriptions" ("id", "organization_id");
CREATE UNIQUE INDEX "billing_customers_tenant_identity"
  ON "billing_customers" ("id", "organization_id");

CREATE TABLE "billing_checkout_attempts" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "subscription_id" UUID NOT NULL,
  "billing_customer_id" UUID NOT NULL,
  "provider" VARCHAR(20) NOT NULL,
  "mode" VARCHAR(10) NOT NULL,
  "plan_code" VARCHAR(60) NOT NULL,
  "billing_interval" VARCHAR(20) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'CREATING',
  "idempotency_key" VARCHAR(64) NOT NULL,
  "provider_session_id" VARCHAR(255),
  "provider_subscription_id" VARCHAR(255),
  "expires_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "billing_checkout_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "billing_checkout_attempts_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "billing_checkout_attempts_subscription_tenant_fkey"
    FOREIGN KEY ("subscription_id", "organization_id")
    REFERENCES "organization_subscriptions"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_checkout_attempts_customer_tenant_fkey"
    FOREIGN KEY ("billing_customer_id", "organization_id")
    REFERENCES "billing_customers"("id", "organization_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "billing_checkout_attempts_provider_valid"
    CHECK ("provider" IN ('STRIPE')),
  CONSTRAINT "billing_checkout_attempts_mode_valid"
    CHECK ("mode" IN ('TEST', 'LIVE')),
  CONSTRAINT "billing_checkout_attempts_status_valid"
    CHECK ("status" IN ('CREATING','OPEN','COMPLETED','EXPIRED','FAILED')),
  CONSTRAINT "billing_checkout_attempts_interval_valid"
    CHECK ("billing_interval" IN ('MONTHLY','SEMIANNUAL','ANNUAL'))
);

CREATE UNIQUE INDEX "billing_checkout_attempts_idempotency_unique"
  ON "billing_checkout_attempts" ("provider", "idempotency_key");
CREATE UNIQUE INDEX "billing_checkout_attempts_provider_session_unique"
  ON "billing_checkout_attempts" ("provider", "provider_session_id");
CREATE UNIQUE INDEX "billing_checkout_attempts_one_active_per_org"
  ON "billing_checkout_attempts" ("organization_id", "provider", "mode")
  WHERE "status" IN ('CREATING', 'OPEN');
CREATE INDEX "billing_checkout_attempts_org_status_created_idx"
  ON "billing_checkout_attempts" ("organization_id", "status", "created_at");
CREATE INDEX "billing_checkout_attempts_subscription_created_idx"
  ON "billing_checkout_attempts" ("subscription_id", "created_at");

ALTER TABLE "billing_checkout_attempts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_checkout_attempts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "billing_checkout_attempts_tenant_isolation"
  ON "billing_checkout_attempts"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

-- Sem DELETE: tentativa concluída é histórico de correlação e auditoria.
GRANT SELECT, INSERT, UPDATE ON TABLE "billing_checkout_attempts" TO orbit_app;
