-- Tipos de manutencao de RVT, com cadencia e roteiro proprios.
--
-- `rvt_configurations.visit_type` era um literal de dois valores — WEEKLY e
-- SEMIANNUAL — e governava a matematica de recorrencia. Operacao real tem
-- mensal, trimestral e anual, e cada ritmo novo exigia outra migracao e outro
-- `if` no dominio.
--
-- A ordem importa: cria o catalogo, semeia, aponta cada contrato para o tipo
-- equivalente ao que ele tinha, e so entao derruba a coluna.

CREATE TABLE IF NOT EXISTS "rvt_maintenance_types" (
  "id"                    UUID PRIMARY KEY,
  "organization_id"       UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "key"                   VARCHAR(60) NOT NULL,
  "label"                 VARCHAR(120) NOT NULL,
  "interval_days"         INTEGER,
  "interval_months"       INTEGER,
  "checklist_template_id" UUID REFERENCES "checklist_templates"("id") ON DELETE SET NULL,
  "sort_order"            INTEGER NOT NULL DEFAULT 0,
  "is_active"             BOOLEAN NOT NULL DEFAULT true,
  "created_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deleted_at"            TIMESTAMPTZ(3),
  CONSTRAINT "rvt_maintenance_types_org_key_key" UNIQUE ("organization_id", "key")
);

CREATE INDEX IF NOT EXISTS "rvt_maintenance_types_org_active_idx"
  ON "rvt_maintenance_types" ("organization_id", "is_active", "deleted_at");

ALTER TABLE "rvt_maintenance_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rvt_maintenance_types" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rvt_maintenance_types_tenant" ON "rvt_maintenance_types";
CREATE POLICY "rvt_maintenance_types_tenant" ON "rvt_maintenance_types"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "rvt_maintenance_types" TO orbit_app;

-- Os ritmos que toda organizacao tem no primeiro dia.
--
-- Dias para os curtos, meses para os que seguem o calendario: somar 30 dias nao
-- e somar um mes, e quem contrata trimestral espera a visita no mesmo dia do
-- terceiro mes.
INSERT INTO "rvt_maintenance_types" (
  "id", "organization_id", "key", "label",
  "interval_days", "interval_months", "sort_order", "created_at", "updated_at"
)
SELECT
  (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  o."id", t."key", t."label", t."dias", t."meses", t."ordem", now(), now()
FROM "organizations" o
CROSS JOIN (VALUES
  ('WEEKLY',     'Semanal',     7,    NULL, 10),
  ('BIWEEKLY',   'Quinzenal',   14,   NULL, 20),
  ('MONTHLY',    'Mensal',      NULL, 1,    30),
  ('BIMONTHLY',  'Bimestral',   NULL, 2,    40),
  ('QUARTERLY',  'Trimestral',  NULL, 3,    50),
  ('SEMIANNUAL', 'Semestral',   NULL, 6,    60),
  ('ANNUAL',     'Anual',       NULL, 12,   70)
) AS t("key", "label", "dias", "meses", "ordem")
WHERE o."deleted_at" IS NULL
ON CONFLICT ("organization_id", "key") DO NOTHING;

-- Cada contrato aponta para o tipo equivalente ao que ele ja tinha.
ALTER TABLE "rvt_configurations"
  ADD COLUMN IF NOT EXISTS "maintenance_type_id" UUID
  REFERENCES "rvt_maintenance_types"("id") ON DELETE SET NULL;

UPDATE "rvt_configurations" c
   SET "maintenance_type_id" = t."id"
  FROM "rvt_maintenance_types" t
 WHERE t."organization_id" = c."organization_id"
   AND t."key" = c."visit_type"
   AND c."maintenance_type_id" IS NULL;

CREATE INDEX IF NOT EXISTS "rvt_configurations_maintenance_type_idx"
  ON "rvt_configurations" ("maintenance_type_id");

ALTER TABLE "rvt_configurations" DROP COLUMN IF EXISTS "visit_type";

-- O checklist que o tecnico preenche na visita.
--
-- Reusa `checklist_executions`, cujo `operation_id` sempre foi opcional: o
-- modelo foi feito para checklist que nao pertence a uma ordem.
ALTER TABLE "checklist_executions"
  ADD COLUMN IF NOT EXISTS "rvt_execution_id" UUID
  REFERENCES "rvt_executions"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "checklist_executions_rvt_execution_idx"
  ON "checklist_executions" ("rvt_execution_id");
