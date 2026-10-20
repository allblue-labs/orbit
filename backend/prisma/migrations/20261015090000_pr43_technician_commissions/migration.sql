-- PR-43 — comissão de técnicos: política da organização e pagamentos.
--
-- A comissão *pendente* não tem tabela: é derivada de atendimento concluído,
-- técnico responsável, auxiliares ativos e receita confirmada, cruzados com a
-- política vigente. O que se grava é o pagamento, e nele o valor congela.

CREATE TABLE "commission_policies" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "period" VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
  "mode" VARCHAR(20) NOT NULL DEFAULT 'FIXED',
  "primary_value" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "assistant_value" DECIMAL(14,4) NOT NULL DEFAULT 0,
  "eligible_kinds" VARCHAR(60)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(60)[],
  "requires_confirmed_revenue" BOOLEAN NOT NULL DEFAULT true,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "commission_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_policies_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "commission_policies_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "commission_policies_period_valid"
    CHECK ("period" IN ('WEEKLY','BIWEEKLY','MONTHLY')),
  CONSTRAINT "commission_policies_mode_valid"
    CHECK ("mode" IN ('FIXED','PERCENTAGE')),
  -- Valor negativo seria comissão cobrada do técnico. Percentual acima de 100
  -- entregaria mais que a receita do atendimento.
  CONSTRAINT "commission_policies_values_nonnegative"
    CHECK ("primary_value" >= 0 AND "assistant_value" >= 0),
  CONSTRAINT "commission_policies_percentage_within_bounds"
    CHECK (
      "mode" <> 'PERCENTAGE'
      OR ("primary_value" <= 100 AND "assistant_value" <= 100)
    )
);

-- Uma política por organização: as regras são combinadas com a equipe, não por
-- filial.
CREATE UNIQUE INDEX "commission_policies_organization_unique"
  ON "commission_policies" ("organization_id");

ALTER TABLE "commission_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "commission_policies_tenant_isolation"
  ON "commission_policies"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "commission_policies" TO orbit_app;

CREATE TABLE "commission_payments" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID,
  "user_id" UUID NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'BRL',
  "method" VARCHAR(20),
  "notes" TEXT,
  "period_start" DATE,
  "period_end" DATE,
  "paid_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_payments_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "commission_payments_business_unit_fkey"
    FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "commission_payments_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_payments_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_payments_method_valid"
    CHECK ("method" IS NULL OR "method" IN ('PIX','TRANSFER','CASH','PAYROLL','OTHER')),
  -- Pagamento de valor zero é registro sem fato; negativo é cobrança.
  CONSTRAINT "commission_payments_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "commission_payments_period_valid"
    CHECK (
      "period_start" IS NULL OR "period_end" IS NULL
      OR "period_start" <= "period_end"
    )
);

CREATE UNIQUE INDEX "commission_payments_tenant_identity"
  ON "commission_payments" ("id", "organization_id");
CREATE INDEX "commission_payments_org_user_paid_idx"
  ON "commission_payments" ("organization_id", "user_id", "paid_at" DESC);

ALTER TABLE "commission_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY "commission_payments_tenant_isolation"
  ON "commission_payments"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

-- Sem DELETE: pagamento de comissão é fato contábil. Corrigir é registrar o
-- contrário, não apagar.
GRANT SELECT, INSERT, UPDATE ON TABLE "commission_payments" TO orbit_app;

CREATE TABLE "commission_payment_items" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "payment_id" UUID NOT NULL,
  "operation_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" VARCHAR(20) NOT NULL,
  "mode" VARCHAR(20) NOT NULL,
  "rate" DECIMAL(14,4) NOT NULL,
  "base_amount" DECIMAL(14,2),
  "amount" DECIMAL(14,2) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commission_payment_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_payment_items_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "commission_payment_items_payment_tenant_fkey"
    FOREIGN KEY ("payment_id", "organization_id")
    REFERENCES "commission_payments"("id", "organization_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "commission_payment_items_operation_fkey"
    FOREIGN KEY ("operation_id") REFERENCES "operations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_payment_items_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_payment_items_role_valid"
    CHECK ("role" IN ('PRIMARY','ASSISTANT')),
  CONSTRAINT "commission_payment_items_mode_valid"
    CHECK ("mode" IN ('FIXED','PERCENTAGE')),
  CONSTRAINT "commission_payment_items_amounts_nonnegative"
    CHECK ("rate" >= 0 AND "amount" >= 0 AND ("base_amount" IS NULL OR "base_amount" >= 0))
);

-- O que impede pagar a mesma comissão duas vezes. Não é validação de
-- aplicação: é o banco recusando. Dois cliques simultâneos em "pagar todas"
-- terminam com um pagamento e um erro, nunca com dois pagamentos.
CREATE UNIQUE INDEX "commission_payment_items_unique_per_role"
  ON "commission_payment_items" ("organization_id", "operation_id", "user_id", "role");
CREATE INDEX "commission_payment_items_org_user_created_idx"
  ON "commission_payment_items" ("organization_id", "user_id", "created_at" DESC);
CREATE INDEX "commission_payment_items_payment_idx"
  ON "commission_payment_items" ("payment_id");

ALTER TABLE "commission_payment_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_payment_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "commission_payment_items_tenant_isolation"
  ON "commission_payment_items"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

-- Append-only: o item é o histórico do que foi pago.
GRANT SELECT, INSERT ON TABLE "commission_payment_items" TO orbit_app;
