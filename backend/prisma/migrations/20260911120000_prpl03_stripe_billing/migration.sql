-- PR-PL-03 — integração de cobrança e caixa de entrada de eventos do provedor.
--
-- Aditiva. A assinatura ganha colunas **opcionais** de vínculo: uma assinatura
-- existe e vale sem provedor nenhum, e é assim que a avaliação gratuita e os
-- inquilinos anteriores continuam funcionando.

-- ---------------------------------------------------------------------------
-- Vínculo com o provedor na assinatura
-- ---------------------------------------------------------------------------

ALTER TABLE "organization_subscriptions"
  ADD COLUMN "provider" VARCHAR(20),
  ADD COLUMN "provider_subscription_id" VARCHAR(255),
  ADD COLUMN "provider_customer_id" VARCHAR(255),
  ADD COLUMN "provider_price_id" VARCHAR(255),
  ADD COLUMN "provider_status" VARCHAR(40),
  ADD COLUMN "provider_last_event_id" VARCHAR(255),
  ADD COLUMN "provider_updated_at" TIMESTAMPTZ(3);

-- Uma assinatura do provedor pertence a uma assinatura do Orbit, e só a uma.
-- É o que impede dois vínculos nascerem de duas entregas concorrentes.
CREATE UNIQUE INDEX "organization_subscriptions_provider_subscription_id_key"
  ON "organization_subscriptions" ("provider_subscription_id");

CREATE INDEX "organization_subscriptions_provider_customer_idx"
  ON "organization_subscriptions" ("provider", "provider_customer_id");

ALTER TABLE "organization_subscriptions"
  ADD CONSTRAINT "organization_subscriptions_provider_valid"
  CHECK ("provider" IS NULL OR "provider" IN ('STRIPE'));

-- ---------------------------------------------------------------------------
-- Cliente de cobrança
-- ---------------------------------------------------------------------------

CREATE TABLE "billing_customers" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "mode" VARCHAR(10) NOT NULL,
    "provider_customer_id" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_customers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "billing_customers"
  ADD CONSTRAINT "billing_customers_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Um identificador do provedor pertence a uma organização, e só a uma: é o que
-- impede vínculo cruzado entre inquilinos.
CREATE UNIQUE INDEX "billing_customers_provider_customer_unique"
  ON "billing_customers" ("provider", "provider_customer_id");

-- E uma organização tem um cliente por provedor e por modo. Duas criações
-- concorrentes colidem aqui, e não num contador da aplicação.
CREATE UNIQUE INDEX "billing_customers_organization_unique"
  ON "billing_customers" ("organization_id", "provider", "mode");

CREATE INDEX "billing_customers_organization_idx"
  ON "billing_customers" ("organization_id");

ALTER TABLE "billing_customers"
  ADD CONSTRAINT "billing_customers_provider_valid"
  CHECK ("provider" IN ('STRIPE'));
ALTER TABLE "billing_customers"
  ADD CONSTRAINT "billing_customers_mode_valid"
  CHECK ("mode" IN ('TEST', 'LIVE'));

-- Dado de inquilino: isolamento obrigatório, e FORCE para valer também para o
-- dono da tabela.
ALTER TABLE "billing_customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_customers" FORCE ROW LEVEL SECURITY;

CREATE POLICY "billing_customers_tenant_isolation" ON "billing_customers"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE ON TABLE "billing_customers" TO orbit_app;

-- ---------------------------------------------------------------------------
-- Caixa de entrada dos eventos do provedor
-- ---------------------------------------------------------------------------

CREATE TABLE "billing_webhook_events" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "provider_event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(120) NOT NULL,
    "provider_object_id" VARCHAR(255),
    "provider_subscription_id" VARCHAR(255),
    "api_version" VARCHAR(40),
    "provider_created_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(80),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);

-- Provedores reentregam. O mesmo evento pode chegar dez vezes, e nenhuma delas
-- pode virar um segundo efeito: quem decide isso é este índice, no banco, e
-- não uma consulta anterior que teria janela entre ler e escrever.
CREATE UNIQUE INDEX "billing_webhook_events_provider_event_unique"
  ON "billing_webhook_events" ("provider", "provider_event_id");

CREATE INDEX "billing_webhook_events_pending_idx"
  ON "billing_webhook_events" ("processing_status", "received_at");
CREATE INDEX "billing_webhook_events_subscription_idx"
  ON "billing_webhook_events" ("provider_subscription_id");

ALTER TABLE "billing_webhook_events"
  ADD CONSTRAINT "billing_webhook_events_status_valid"
  CHECK ("processing_status" IN ('PENDING','PROCESSED','IGNORED','FAILED'));
ALTER TABLE "billing_webhook_events"
  ADD CONSTRAINT "billing_webhook_events_provider_valid"
  CHECK ("provider" IN ('STRIPE'));
ALTER TABLE "billing_webhook_events"
  ADD CONSTRAINT "billing_webhook_events_attempts_valid"
  CHECK ("attempts" >= 0);

-- A caixa de entrada é infraestrutura da plataforma, e não de um inquilino: o
-- evento chega antes de sabermos de quem ele é. Uma política por inquilino
-- esconderia todo evento do próprio processador.
--
-- Restrita, então, por contexto de plataforma: só quem declara
-- `is_platform_admin` enxerga. O caminho do webhook é autenticado pela
-- assinatura do provedor e age como sistema; nenhuma requisição de inquilino
-- alcança esta tabela.
ALTER TABLE "billing_webhook_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_webhook_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "billing_webhook_events_platform_only" ON "billing_webhook_events"
  USING (app_is_platform_admin())
  WITH CHECK (app_is_platform_admin());

-- Sem DELETE: a memória de que um evento foi processado é o que impede o
-- segundo efeito quando o provedor reentrega semanas depois.
GRANT SELECT, INSERT, UPDATE ON TABLE "billing_webhook_events" TO orbit_app;
