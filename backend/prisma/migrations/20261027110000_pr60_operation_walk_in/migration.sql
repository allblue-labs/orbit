-- O atendimento avulso aberto em campo.
--
-- ## O que o comando faz
--
-- O técnico está na porta de alguém que não tem ordem aberta — às vezes de
-- alguém que não é cliente ainda. Em uma chamada, ele registra o cliente (ou
-- escolhe um existente), os equipamentos daquele endereço, e a ordem de serviço
-- que ele vai executar agora.
--
-- ## Por que uma tabela de idempotência
--
-- Porque o comando cria **três** coisas de naturezas diferentes — cliente,
-- equipamentos e ordem — e a resposta pode se perder no caminho de volta: é
-- exatamente o caso em campo, com a rede oscilando na calçada. Sem isto, tocar
-- "tentar de novo" cadastraria o mesmo cliente outra vez, e o técnico ficaria
-- com dois cadastros e duas ordens para o mesmo serviço.
--
-- Mesmo desenho de `rvt_ad_hoc_commands`, que resolve o mesmo problema para a
-- visita técnica avulsa. O hash do payload existe para recusar a reutilização
-- da chave com outro conteúdo — reenvio é reenvio; chave repetida com dados
-- diferentes é defeito do cliente, e merece 409 em vez de silêncio.
CREATE TABLE "operation_walk_in_commands" (
  "id"               UUID PRIMARY KEY,
  "organization_id"  UUID           NOT NULL,
  "business_unit_id" UUID           NOT NULL,
  "actor_id"         UUID           NOT NULL,
  "idempotency_key"  VARCHAR(160)   NOT NULL,
  "payload_hash"     CHAR(64)       NOT NULL,
  "operation_id"     UUID           NOT NULL,
  "customer_id"      UUID           NOT NULL,
  -- Quantos equipamentos o comando criou. Zero é legítimo: o técnico pode abrir
  -- a ordem antes de identificar os aparelhos.
  "created_asset_count" INTEGER     NOT NULL DEFAULT 0,
  "created_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

  CONSTRAINT "owic_organization_fk" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "owic_business_unit_fk" FOREIGN KEY ("business_unit_id")
    REFERENCES "business_units"("id") ON DELETE CASCADE,
  CONSTRAINT "owic_actor_fk" FOREIGN KEY ("actor_id")
    REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "owic_operation_fk" FOREIGN KEY ("operation_id")
    REFERENCES "operations"("id") ON DELETE CASCADE,
  CONSTRAINT "owic_customer_fk" FOREIGN KEY ("customer_id")
    REFERENCES "customers"("id") ON DELETE CASCADE,

  CONSTRAINT "owic_asset_count_positive" CHECK ("created_asset_count" >= 0)
);

-- Uma chave por ator, por organização: é o que torna o reenvio seguro.
CREATE UNIQUE INDEX "owic_key_unique"
  ON "operation_walk_in_commands" ("organization_id", "actor_id", "idempotency_key");

CREATE INDEX "owic_org_idx"
  ON "operation_walk_in_commands" ("organization_id", "business_unit_id", "created_at");

ALTER TABLE "operation_walk_in_commands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operation_walk_in_commands" FORCE ROW LEVEL SECURITY;
CREATE POLICY "operation_walk_in_commands_tenant" ON "operation_walk_in_commands" FOR ALL
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "operation_walk_in_commands" TO orbit_app;

COMMENT ON TABLE "operation_walk_in_commands" IS
  'Idempotência do atendimento avulso: cliente, equipamentos e ordem numa chamada.';
