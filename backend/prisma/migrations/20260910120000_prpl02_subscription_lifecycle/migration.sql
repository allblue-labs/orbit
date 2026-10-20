-- PR-PL-02 — assinatura, períodos de cobrança e elegibilidade de avaliação.
--
-- Aditiva: nenhuma coluna existente muda. `organizations.plan_id` continua no
-- lugar; ele deixa de ser autoridade, não deixa de existir.

-- ---------------------------------------------------------------------------
-- Assinatura
-- ---------------------------------------------------------------------------

CREATE TABLE "organization_subscriptions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_code" VARCHAR(60) NOT NULL,
    "catalog_version" INTEGER NOT NULL,
    "entitlements_snapshot" JSONB NOT NULL,
    "billing_interval" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "billing_anchor_at" TIMESTAMPTZ(3) NOT NULL,
    "current_period_start" TIMESTAMPTZ(3) NOT NULL,
    "current_period_end" TIMESTAMPTZ(3) NOT NULL,
    "trial_starts_at" TIMESTAMPTZ(3),
    "trial_ends_at" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(3),
    "grace_starts_at" TIMESTAMPTZ(3),
    "grace_ends_at" TIMESTAMPTZ(3),
    "pending_plan_code" VARCHAR(60),
    "pending_billing_interval" VARCHAR(20),
    "pending_catalog_version" INTEGER,
    "pending_entitlements_snapshot" JSONB,
    "pending_effective_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Uma assinatura corrente por organização. O histórico fica: encerrar preenche
-- `ended_at` e a linha sai do índice, em vez de ser apagada.
CREATE UNIQUE INDEX "organization_subscriptions_current_unique"
  ON "organization_subscriptions" ("organization_id")
  WHERE "ended_at" IS NULL;

CREATE INDEX "organization_subscriptions_organization_idx"
  ON "organization_subscriptions" ("organization_id", "ended_at");

-- Os índices que o reconciliador varre por prazo. Sem eles, cada passagem do
-- worker viraria varredura de tabela inteira.
CREATE INDEX "organization_subscriptions_period_idx"
  ON "organization_subscriptions" ("status", "current_period_end");
CREATE INDEX "organization_subscriptions_trial_idx"
  ON "organization_subscriptions" ("status", "trial_ends_at");
CREATE INDEX "organization_subscriptions_grace_idx"
  ON "organization_subscriptions" ("status", "grace_ends_at");
CREATE INDEX "organization_subscriptions_pending_idx"
  ON "organization_subscriptions" ("pending_effective_at");

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_status_valid" CHECK (
    "status" IN ('TRIALING','ACTIVE','PAST_DUE','GRACE_PERIOD','SUSPENDED','CANCELED','EXPIRED')
  );

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_interval_valid" CHECK (
    "billing_interval" IN ('MONTHLY','SEMIANNUAL','ANNUAL')
  );

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_period_valid"
  CHECK ("current_period_end" > "current_period_start");

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_trial_valid"
  CHECK (
    ("trial_starts_at" IS NULL AND "trial_ends_at" IS NULL)
    OR ("trial_starts_at" IS NOT NULL AND "trial_ends_at" > "trial_starts_at")
  );

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_grace_valid"
  CHECK (
    ("grace_starts_at" IS NULL AND "grace_ends_at" IS NULL)
    OR ("grace_starts_at" IS NOT NULL AND "grace_ends_at" > "grace_starts_at")
  );

-- Mudança programada é tudo ou nada: plano pendente sem data seria uma
-- intenção que nunca acontece, e data sem plano seria um relógio sem alvo.
ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_pending_valid"
  CHECK (
    ("pending_plan_code" IS NULL
      AND "pending_effective_at" IS NULL
      AND "pending_entitlements_snapshot" IS NULL
      AND "pending_catalog_version" IS NULL)
    OR ("pending_plan_code" IS NOT NULL
      AND "pending_effective_at" IS NOT NULL
      AND "pending_entitlements_snapshot" IS NOT NULL
      AND "pending_catalog_version" IS NOT NULL)
  );

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_version_positive" CHECK ("version" > 0);

ALTER TABLE "organization_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_subscriptions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "organization_subscriptions_tenant_isolation" ON "organization_subscriptions"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "organization_subscriptions" TO orbit_app;

-- ---------------------------------------------------------------------------
-- Avaliação gratuita
-- ---------------------------------------------------------------------------

CREATE TABLE "subscription_trial_grants" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "plan_code" VARCHAR(60) NOT NULL,
    -- HMAC-SHA256 em hexadecimal. O documento cru não mora aqui.
    "legal_document_fingerprint" CHAR(64) NOT NULL,
    "granted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "risk_decision" VARCHAR(20) NOT NULL,
    "risk_signals" JSONB,
    "converted_subscription_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscription_trial_grants_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "subscription_trial_grants"
  ADD CONSTRAINT "subscription_trial_grants_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "subscription_trial_grants"
  ADD CONSTRAINT "subscription_trial_grants_converted_subscription_id_fkey"
  FOREIGN KEY ("converted_subscription_id") REFERENCES "organization_subscriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- O antifraude, em uma linha de SQL.
--
-- Único **global**, de propósito: a mesma entidade jurídica não recebe um
-- segundo período de teste em organização nenhuma. Duas tentativas concorrentes
-- não precisam de bloqueio da aplicação — a segunda colide aqui.
CREATE UNIQUE INDEX "subscription_trial_grants_fingerprint_unique"
  ON "subscription_trial_grants" ("legal_document_fingerprint");

CREATE INDEX "subscription_trial_grants_organization_idx"
  ON "subscription_trial_grants" ("organization_id");
CREATE INDEX "subscription_trial_grants_expiry_idx"
  ON "subscription_trial_grants" ("status", "ends_at");

ALTER TABLE "subscription_trial_grants"
  ADD CONSTRAINT "subscription_trial_grants_status_valid"
  CHECK ("status" IN ('GRANTED','CONVERTED','EXPIRED'));

ALTER TABLE "subscription_trial_grants"
  ADD CONSTRAINT "subscription_trial_grants_risk_valid"
  CHECK ("risk_decision" IN ('ALLOW','REVIEW_REQUIRED','DENY'));

ALTER TABLE "subscription_trial_grants"
  ADD CONSTRAINT "subscription_trial_grants_period_valid"
  CHECK ("ends_at" > "starts_at");

-- O registro é global para o índice único, e **privado** para a leitura: cada
-- organização enxerga a sua concessão e nenhuma outra. É o que impede que uma
-- credencial de runtime vire lista de quem já testou o Orbit.
ALTER TABLE "subscription_trial_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscription_trial_grants" FORCE ROW LEVEL SECURITY;

CREATE POLICY "subscription_trial_grants_tenant_isolation" ON "subscription_trial_grants"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

-- Sem DELETE: a memória de que uma avaliação existiu é o próprio antifraude.
GRANT SELECT, INSERT, UPDATE ON TABLE "subscription_trial_grants" TO orbit_app;

-- A única leitura cruzada permitida, e ela responde sim ou não.
--
-- Nem organização, nem data, nem quem — só se aquele documento já consumiu a
-- avaliação. É o mínimo para responder "elegível?" sem transformar a resposta
-- num oráculo sobre a base de clientes.
CREATE OR REPLACE FUNCTION app_trial_fingerprint_consumed(p_fingerprint text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM subscription_trial_grants
     WHERE legal_document_fingerprint = p_fingerprint
  );
$$;

REVOKE ALL ON FUNCTION app_trial_fingerprint_consumed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_trial_fingerprint_consumed(text) TO orbit_app;
