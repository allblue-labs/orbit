-- Unidades do sistema que recebem manutencao — condensadora, evaporadora,
-- dutos, torre.
--
-- Unidade nao e equipamento: `assets` e a maquina sob contrato ("Split
-- Cassete 1, Sala 1"); unidade e a parte dela que recebe manutencao, e cada
-- parte tem o seu roteiro. Um plano cobre equipamentos e declara unidades.

CREATE TABLE "pmoc_units" (
  "id"                    UUID         NOT NULL,
  "organization_id"       UUID         NOT NULL,
  "key"                   VARCHAR(60)  NOT NULL,
  "name"                  VARCHAR(160) NOT NULL,
  "description"           TEXT,
  "checklist_template_id" UUID,
  "sort_order"            INTEGER      NOT NULL DEFAULT 0,
  "is_active"             BOOLEAN      NOT NULL DEFAULT true,
  "created_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ(3) NOT NULL,
  "deleted_at"            TIMESTAMPTZ(3),

  CONSTRAINT "pmoc_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pmoc_units_organization_id_key_key"
  ON "pmoc_units" ("organization_id", "key");
CREATE INDEX "pmoc_units_organization_id_is_active_deleted_at_idx"
  ON "pmoc_units" ("organization_id", "is_active", "deleted_at");
CREATE INDEX "pmoc_units_checklist_template_id_idx"
  ON "pmoc_units" ("checklist_template_id");

ALTER TABLE "pmoc_units"
  ADD CONSTRAINT "pmoc_units_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- `SET NULL`: apagar um modelo de checklist nao pode apagar a unidade. A
-- unidade continua existindo, sem roteiro, e quem administra ve isso na tela.
ALTER TABLE "pmoc_units"
  ADD CONSTRAINT "pmoc_units_checklist_template_id_fkey"
  FOREIGN KEY ("checklist_template_id") REFERENCES "checklist_templates"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Dado de inquilino: isolamento obrigatorio, e FORCE para valer tambem para
-- o dono da tabela.
ALTER TABLE "pmoc_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pmoc_units" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pmoc_units_tenant_isolation" ON "pmoc_units"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pmoc_units" TO orbit_app;

-- ---------------------------------------------------------------------------
-- As unidades declaradas por um plano
-- ---------------------------------------------------------------------------

CREATE TABLE "pmoc_plan_units" (
  "id"         UUID NOT NULL,
  "plan_id"    UUID NOT NULL,
  "unit_id"    UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pmoc_plan_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pmoc_plan_units_plan_id_unit_id_key"
  ON "pmoc_plan_units" ("plan_id", "unit_id");
CREATE INDEX "pmoc_plan_units_unit_id_idx" ON "pmoc_plan_units" ("unit_id");

ALTER TABLE "pmoc_plan_units"
  ADD CONSTRAINT "pmoc_plan_units_plan_id_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "pmoc_plans"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pmoc_plan_units"
  ADD CONSTRAINT "pmoc_plan_units_unit_id_fkey"
  FOREIGN KEY ("unit_id") REFERENCES "pmoc_units"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Nao carrega `organization_id`: o isolamento vem do plano, por FK. A
-- politica olha o plano em vez de duplicar a coluna, que e o que evita as
-- duas fontes discordarem.
ALTER TABLE "pmoc_plan_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pmoc_plan_units" FORCE ROW LEVEL SECURITY;

CREATE POLICY "pmoc_plan_units_tenant_isolation" ON "pmoc_plan_units"
  USING (
    app_is_platform_admin() OR EXISTS (
      SELECT 1 FROM "pmoc_plans" p
      WHERE p."id" = "pmoc_plan_units"."plan_id"
        AND p."organization_id" = app_current_organization_id()
    )
  )
  WITH CHECK (
    app_is_platform_admin() OR EXISTS (
      SELECT 1 FROM "pmoc_plans" p
      WHERE p."id" = "pmoc_plan_units"."plan_id"
        AND p."organization_id" = app_current_organization_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "pmoc_plan_units" TO orbit_app;
