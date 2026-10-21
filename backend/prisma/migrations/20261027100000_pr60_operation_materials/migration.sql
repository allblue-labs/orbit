-- Os materiais de um atendimento: o que foi previsto e o que foi aplicado.
--
-- ## Por que não bastava o movimento de estoque
--
-- Material aplicado existia só como `inventory_movements`, e um movimento exige
-- `catalog_item_id`: ele move saldo. Isso cobria exatamente um caso — o item de
-- almoxarifado que a empresa cadastrou — e deixava de fora os dois que o campo
-- pede todo dia:
--
--   previsto   — o que quem abriu a ordem disse que seria usado, antes de
--                existir qualquer movimento;
--   avulso     — a abraçadeira, o metro de fita, o parafuso que o técnico
--                comprou na esquina. Não tem item de catálogo, não move saldo,
--                e precisa sair no relatório porque é o que foi cobrado.
--
-- Sem lugar para os dois, a etapa de materiais do roteiro não tinha nada a
-- mostrar: ela abria com dois botões e a frase "este atendimento não prevê
-- registro de materiais", que era verdade sobre a permissão e mentira sobre o
-- atendimento.
--
-- ## A linha é o registro; o movimento é consequência
--
-- Quando o material tem item de catálogo, o movimento de estoque continua
-- acontecendo e fica referenciado aqui. A linha é o que o documento imprime; o
-- movimento é o que o saldo sofre. Separados, porque um material avulso tem a
-- primeira e não a segunda — e um movimento estornado não deve apagar do
-- relatório o que de fato foi aplicado.
CREATE TABLE "operation_materials" (
  "id"                    UUID PRIMARY KEY,
  "organization_id"       UUID           NOT NULL,
  "business_unit_id"      UUID           NOT NULL,
  "operation_id"          UUID           NOT NULL,

  -- `PLANNED` nasce com a ordem; `APPLIED` é registrado em campo.
  "origin"                VARCHAR(20)    NOT NULL,

  -- Nulo é material avulso: descrição livre, sem saldo a mover.
  "catalog_item_id"       UUID,
  "inventory_movement_id" UUID,

  "description"           VARCHAR(255)   NOT NULL,
  "unit"                  VARCHAR(20)    NOT NULL DEFAULT 'UN',
  "quantity"              DECIMAL(14, 3) NOT NULL,
  "notes"                 VARCHAR(500),

  -- A chave de idempotência do comando que criou a linha.
  --
  -- A captura em campo é offline-first: o mesmo registro é reenviado quando a
  -- rede volta, e sem isto a abraçadeira entrava duas vezes no relatório. Nula
  -- em material previsto, que nasce na abertura da ordem e não vem de comando.
  "command_id"            VARCHAR(160),

  "created_by_id"         UUID,
  "created_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deleted_at"            TIMESTAMPTZ(3),

  CONSTRAINT "om_organization_fk" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "om_business_unit_fk" FOREIGN KEY ("business_unit_id")
    REFERENCES "business_units"("id") ON DELETE RESTRICT,
  CONSTRAINT "om_operation_fk" FOREIGN KEY ("operation_id")
    REFERENCES "operations"("id") ON DELETE CASCADE,
  CONSTRAINT "om_catalog_item_fk" FOREIGN KEY ("catalog_item_id")
    REFERENCES "products"("id") ON DELETE SET NULL,
  CONSTRAINT "om_inventory_movement_fk" FOREIGN KEY ("inventory_movement_id")
    REFERENCES "inventory_movements"("id") ON DELETE SET NULL,
  CONSTRAINT "om_created_by_fk" FOREIGN KEY ("created_by_id")
    REFERENCES "users"("id") ON DELETE SET NULL,

  CONSTRAINT "om_origin_check" CHECK ("origin" IN ('PLANNED','APPLIED')),

  -- Descrição em branco produziria uma linha no relatório que não diz o que foi
  -- usado. Mesmo vindo do catálogo, o nome é copiado: o documento é congelado, e
  -- renomear o produto depois não deve reescrever uma OS já assinada.
  CONSTRAINT "om_description_present" CHECK (btrim("description") <> ''),

  -- Quantidade zero ou negativa não é material aplicado; é ruído que soma errado
  -- em qualquer totalização.
  CONSTRAINT "om_quantity_positive" CHECK ("quantity" > 0),

  -- Movimento de estoque só existe com item de catálogo: é ele que tem saldo.
  CONSTRAINT "om_movement_requires_item" CHECK (
    "inventory_movement_id" IS NULL OR "catalog_item_id" IS NOT NULL
  )
);

CREATE INDEX "om_operation_idx"
  ON "operation_materials" ("operation_id", "origin", "created_at");
CREATE INDEX "om_org_idx"
  ON "operation_materials" ("organization_id", "business_unit_id", "created_at");

-- O mesmo movimento de estoque não gera duas linhas.
--
-- Parcial para ignorar os nulos — material avulso não tem movimento, e um único
-- na coluna faria o segundo avulso colidir com o primeiro.
-- Um comando, uma linha. Parcial porque previsto não tem comando.
CREATE UNIQUE INDEX "om_command_unique"
  ON "operation_materials" ("organization_id", "command_id")
  WHERE "command_id" IS NOT NULL;

CREATE UNIQUE INDEX "om_movement_unique"
  ON "operation_materials" ("inventory_movement_id")
  WHERE "inventory_movement_id" IS NOT NULL;

ALTER TABLE "operation_materials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operation_materials" FORCE ROW LEVEL SECURITY;
CREATE POLICY "operation_materials_tenant" ON "operation_materials" FOR ALL
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "operation_materials" TO orbit_app;

COMMENT ON TABLE "operation_materials" IS
  'Materiais previstos na abertura e aplicados em campo; o que o relatório imprime.';
