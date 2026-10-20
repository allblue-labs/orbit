-- Endereços de atendimento do cliente, equipamentos por atendimento e o setor.
--
-- O cliente tinha um endereço, num campo JSON: suficiente para emitir nota,
-- insuficiente para mandar técnico. E o atendimento tinha um equipamento, o que
-- não é o que o campo encontra — o técnico vai ao endereço e atende os
-- aparelhos que estão lá.
--
-- A ordem importa: cria o vínculo, **copia** o que existe, e só então derruba a
-- coluna. Nenhuma linha perde o equipamento que já tinha.

/* ---------------------------------------------------------------- */
/* Endereços do cliente                                              */
/* ---------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "customer_addresses" (
  "id"              UUID PRIMARY KEY,
  "organization_id" UUID NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "customer_id"     UUID NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "label"           VARCHAR(120) NOT NULL,
  "postal_code"     VARCHAR(16),
  "street"          VARCHAR(255) NOT NULL,
  "number"          VARCHAR(30),
  "complement"      VARCHAR(120),
  "district"        VARCHAR(120),
  "city"            VARCHAR(120) NOT NULL,
  "state_code"      VARCHAR(2),
  "notes"           TEXT,
  "is_primary"      BOOLEAN NOT NULL DEFAULT false,
  "is_active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deleted_at"      TIMESTAMPTZ(3)
);

CREATE INDEX IF NOT EXISTS "customer_addresses_org_customer_deleted_idx"
  ON "customer_addresses" ("organization_id", "customer_id", "deleted_at");

ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_addresses" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_addresses_tenant" ON "customer_addresses";
CREATE POLICY "customer_addresses_tenant" ON "customer_addresses"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "customer_addresses" TO orbit_app;

-- O endereço que o cliente já tinha vira o primeiro endereço de atendimento.
--
-- Só quando há rua e cidade: um JSON pela metade viraria um endereço inútil com
-- ar de cadastrado, e o owner precisa ver que falta preencher.
INSERT INTO "customer_addresses" (
  "id", "organization_id", "customer_id", "label",
  "postal_code", "street", "number", "complement", "district",
  "city", "state_code", "is_primary", "created_at", "updated_at"
)
SELECT
  (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  c."organization_id",
  c."id",
  'Endereço principal',
  nullif(c."address"->>'postalCode', ''),
  c."address"->>'street',
  nullif(c."address"->>'number', ''),
  nullif(c."address"->>'complement', ''),
  nullif(c."address"->>'district', ''),
  c."address"->>'city',
  nullif(c."address"->>'stateCode', ''),
  true,
  now(),
  now()
FROM "customers" c
WHERE c."deleted_at" IS NULL
  AND c."address" IS NOT NULL
  AND coalesce(c."address"->>'street', '') <> ''
  AND coalesce(c."address"->>'city', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "customer_addresses" a WHERE a."customer_id" = c."id"
  );

/* ---------------------------------------------------------------- */
/* Equipamentos do atendimento                                       */
/* ---------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS "operation_assets" (
  "id"           UUID PRIMARY KEY,
  "operation_id" UUID NOT NULL REFERENCES "operations"("id") ON DELETE CASCADE,
  "asset_id"     UUID NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "created_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "operation_assets_operation_asset_key" UNIQUE ("operation_id", "asset_id")
);

CREATE INDEX IF NOT EXISTS "operation_assets_asset_idx" ON "operation_assets" ("asset_id");

-- Sem coluna de inquilino: a política atravessa a ordem, como em pmoc_plan_units.
ALTER TABLE "operation_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operation_assets" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "operation_assets_tenant" ON "operation_assets";
CREATE POLICY "operation_assets_tenant" ON "operation_assets"
  USING (
    app_is_platform_admin() OR EXISTS (
      SELECT 1 FROM "operations" o
       WHERE o."id" = "operation_assets"."operation_id"
         AND o."organization_id" = app_current_organization_id()
    )
  )
  WITH CHECK (
    app_is_platform_admin() OR EXISTS (
      SELECT 1 FROM "operations" o
       WHERE o."id" = "operation_assets"."operation_id"
         AND o."organization_id" = app_current_organization_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "operation_assets" TO orbit_app;

-- O equipamento que cada ordem já tinha. Antes do DROP, sempre.
INSERT INTO "operation_assets" ("id", "operation_id", "asset_id", "created_at")
SELECT
  (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  o."id",
  o."asset_id",
  o."created_at"
FROM "operations" o
WHERE o."asset_id" IS NOT NULL
ON CONFLICT ("operation_id", "asset_id") DO NOTHING;

/* ---------------------------------------------------------------- */
/* Endereço e setor na ordem                                         */
/* ---------------------------------------------------------------- */

ALTER TABLE "operations"
  ADD COLUMN IF NOT EXISTS "customer_address_id" UUID REFERENCES "customer_addresses"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "sector" VARCHAR(120);

CREATE INDEX IF NOT EXISTS "operations_org_customer_address_idx"
  ON "operations" ("organization_id", "customer_address_id");

/* ---------------------------------------------------------------- */
/* O aceite do cliente continua sendo invalidado                     */
/* ---------------------------------------------------------------- */

-- O gatilho da PR-MB-03 vigiava `asset_id`: mudar o equipamento de uma ordem já
-- reconhecida invalidava o aceite, porque o cliente assinou outra coisa.
--
-- A coluna vai embora, e a regra **não** pode ir junto. Ela é reescrita em duas
-- partes: o que continua na própria ordem — agora incluindo endereço e setor,
-- que são igualmente material reconhecido — e o que passou para a tabela de
-- vínculo, onde acrescentar ou remover um equipamento é a mesma mudança de
-- conteúdo que antes era um UPDATE de coluna.
--
-- Sem a segunda parte, trocar os equipamentos de uma ordem assinada deixaria o
-- aceite de pé — exatamente o furo que a PR-MB-03 fechou.

CREATE OR REPLACE FUNCTION invalidate_operation_customer_acknowledgement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF ROW(
    OLD.customer_id, OLD.customer_address_id, OLD.sector, OLD.title,
    OLD.description, OLD.scheduled_start, OLD.scheduled_end, OLD.location
  ) IS DISTINCT FROM ROW(
    NEW.customer_id, NEW.customer_address_id, NEW.sector, NEW.title,
    NEW.description, NEW.scheduled_start, NEW.scheduled_end, NEW.location
  ) THEN
    UPDATE customer_acknowledgements
       SET invalidated_at = CURRENT_TIMESTAMP,
           invalidation_reason = 'EXECUTION_CONTENT_CHANGED'
     WHERE organization_id = OLD.organization_id
       AND execution_type = 'OPERATION'
       AND execution_id = OLD.id
       AND invalidated_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operations_invalidate_customer_acknowledgement ON operations;

DROP INDEX IF EXISTS "operations_organization_id_asset_id_idx";
ALTER TABLE "operations" DROP COLUMN IF EXISTS "asset_id";

CREATE TRIGGER operations_invalidate_customer_acknowledgement
AFTER UPDATE OF customer_id, customer_address_id, sector, title, description,
  scheduled_start, scheduled_end, location
ON operations
FOR EACH ROW
EXECUTE FUNCTION invalidate_operation_customer_acknowledgement();

-- A outra metade: mexer na lista de equipamentos.
CREATE OR REPLACE FUNCTION invalidate_operation_acknowledgement_on_assets()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation_id UUID;
BEGIN
  v_operation_id := COALESCE(NEW.operation_id, OLD.operation_id);

  UPDATE customer_acknowledgements ca
     SET invalidated_at = CURRENT_TIMESTAMP,
         invalidation_reason = 'EXECUTION_CONTENT_CHANGED'
    FROM operations o
   WHERE o.id = v_operation_id
     AND ca.organization_id = o.organization_id
     AND ca.execution_type = 'OPERATION'
     AND ca.execution_id = o.id
     AND ca.invalidated_at IS NULL;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS operation_assets_invalidate_customer_acknowledgement ON operation_assets;
CREATE TRIGGER operation_assets_invalidate_customer_acknowledgement
AFTER INSERT OR DELETE ON operation_assets
FOR EACH ROW
EXECUTE FUNCTION invalidate_operation_acknowledgement_on_assets();
