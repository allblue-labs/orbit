-- Nomes sugeridos para um plano de PMOC.
--
-- Catalogo da plataforma, nao da organizacao: sao os nomes que a norma e o
-- mercado usam, iguais para todo inquilino. Sem organization_id e sem RLS,
-- mesma forma da tabela "plans".
CREATE TABLE "pmoc_plan_name_options" (
  "id"         UUID         NOT NULL,
  "key"        VARCHAR(60)  NOT NULL,
  "label"      VARCHAR(160) NOT NULL,
  "sort_order" INTEGER      NOT NULL DEFAULT 0,
  "is_active"  BOOLEAN      NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "pmoc_plan_name_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pmoc_plan_name_options_key_key"
  ON "pmoc_plan_name_options" ("key");

CREATE INDEX "pmoc_plan_name_options_is_active_sort_order_idx"
  ON "pmoc_plan_name_options" ("is_active", "sort_order");

-- Os padroes. `ON CONFLICT DO NOTHING` mantem a migracao repetivel e nao
-- desfaz edicao feita depois: quem renomear um rotulo no banco o mantem.
INSERT INTO "pmoc_plan_name_options" ("id", "key", "label", "sort_order", "updated_at")
VALUES
  (gen_random_uuid(), 'MANUTENCAO_PREVENTIVA', 'Manutenção Preventiva', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MANUTENCAO_CORRETIVA',  'Manutenção Corretiva',  20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'MANUTENCAO_PREDITIVA',  'Manutenção Preditiva',  30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'HIGIENIZACAO',          'Higienização e Limpeza', 40, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'INSPECAO_TECNICA',      'Inspeção Técnica',      50, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
