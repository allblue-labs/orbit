-- PR-PL-01 — razão de uso de plano.
--
-- Aditiva: nenhuma coluna existente muda, nenhum dado é reescrito. O agregado
-- `plan_usage` continua sendo a leitura rápida de "quanto já se usou"; este
-- razão registra **por causa de quê**, e é o que torna a contagem idempotente.

CREATE TABLE "plan_usage_events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "resource" VARCHAR(100) NOT NULL,
    "window_start" TIMESTAMPTZ(3) NOT NULL,
    "window_end" TIMESTAMPTZ(3) NOT NULL,
    "quantity" DECIMAL(20,4) NOT NULL DEFAULT 1,
    "source_type" VARCHAR(60) NOT NULL,
    "source_id" VARCHAR(120) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_usage_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "plan_usage_events"
  ADD CONSTRAINT "plan_usage_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A identidade do evento de negócio. É esta restrição que faz o segundo
-- registro do mesmo documento falhar em vez de somar de novo.
CREATE UNIQUE INDEX "plan_usage_events_source_unique"
  ON "plan_usage_events" ("organization_id", "resource", "source_type", "source_id");

-- A leitura que importa: quanto esta organização consumiu deste recurso nesta
-- janela.
CREATE INDEX "plan_usage_events_window_idx"
  ON "plan_usage_events" ("organization_id", "resource", "window_start", "window_end");

-- Consumo é positivo. Estorno, se um dia existir, será evento próprio — não um
-- número negativo escondido no mesmo lugar.
ALTER TABLE "plan_usage_events"
  ADD CONSTRAINT "plan_usage_events_quantity_positive" CHECK ("quantity" > 0);

-- A janela precisa ser um intervalo de verdade.
ALTER TABLE "plan_usage_events"
  ADD CONSTRAINT "plan_usage_events_window_valid" CHECK ("window_end" > "window_start");

-- Dado de tenant: isolamento obrigatório, e FORCE para valer também para o
-- dono da tabela. O catálogo de planos continua global e sem RLS.
ALTER TABLE "plan_usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan_usage_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "plan_usage_events_tenant_isolation" ON "plan_usage_events"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

-- O papel de runtime opera a tabela; nada de privilégio administrativo.
-- O razão é acrescido, nunca corrigido: sem UPDATE nem DELETE. Cota consumida
-- por engano se resolve com evento próprio, não apagando história.
GRANT SELECT, INSERT ON TABLE "plan_usage_events" TO orbit_app;
