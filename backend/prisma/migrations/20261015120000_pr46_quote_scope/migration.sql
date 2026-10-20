-- PR-46 — o orçamento passa a saber onde, em quê e por quem.
--
-- O documento premium já imprimia endereço e responsável; o domínio não os
-- guardava. O endereço saía de `customer.addresses[0]` — para quem tem duas
-- filiais, um chute com aparência de dado — e o "responsável" era quem havia
-- digitado a proposta, que não é necessariamente quem assina por ela.
--
-- Equipamento não existia de forma nenhuma, e é o que o cliente procura
-- primeiro numa proposta de manutenção: *quais aparelhos*.

-- O parágrafo de abertura. Campo, e não constante no gerador: é texto que a
-- empresa negocia caso a caso, e um padrão no código obrigaria a alterar o
-- código para mudar uma frase.
ALTER TABLE "quotes" ADD COLUMN "intro_text" TEXT;

-- O endereço de execução, entre os cadastrados do cliente.
-- `SET NULL`: apagar um endereço não pode apagar a proposta que o citou — a
-- proposta é registro comercial, e desaparecer com ela perderia o histórico.
ALTER TABLE "quotes" ADD COLUMN "service_address_id" UUID;
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_service_address_fkey"
  FOREIGN KEY ("service_address_id") REFERENCES "customer_addresses"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Quem responde tecnicamente, e de quem sai a assinatura impressa.
ALTER TABLE "quotes" ADD COLUMN "responsible_user_id" UUID;
ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_responsible_user_fkey"
  FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Consulta do painel: as propostas de um responsável, do mais recente.
CREATE INDEX "quotes_responsible_idx"
  ON "quotes" ("organization_id", "responsible_user_id", "created_at");

/* ---------------------------------------------------------------- */
/* Equipamentos da proposta                                          */
/* ---------------------------------------------------------------- */

CREATE TABLE "quote_assets" (
  "id"       UUID PRIMARY KEY,
  "quote_id" UUID NOT NULL REFERENCES "quotes"("id") ON DELETE CASCADE,
  "asset_id" UUID NOT NULL REFERENCES "assets"("id") ON DELETE CASCADE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "quote_assets_quote_asset_key" UNIQUE ("quote_id", "asset_id")
);

CREATE INDEX "quote_assets_asset_idx" ON "quote_assets" ("asset_id");

-- Sem coluna de inquilino: a política atravessa a proposta, como em
-- `operation_assets`. Repetir `organization_id` aqui criaria a chance de ele
-- discordar do da proposta, e aí duas respostas para a mesma pergunta.
ALTER TABLE "quote_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_assets" FORCE ROW LEVEL SECURITY;

CREATE POLICY "quote_assets_tenant" ON "quote_assets"
  USING (
    app_is_platform_admin() OR EXISTS (
      SELECT 1 FROM "quotes" q
       WHERE q."id" = "quote_assets"."quote_id"
         AND q."organization_id" = app_current_organization_id()
    )
  )
  WITH CHECK (
    app_is_platform_admin() OR EXISTS (
      SELECT 1 FROM "quotes" q
       WHERE q."id" = "quote_assets"."quote_id"
         AND q."organization_id" = app_current_organization_id()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "quote_assets" TO orbit_app;

-- O responsável das propostas que já existem é quem as criou: é a única
-- resposta que os dados suportam, e deixar nulo faria o documento sair sem
-- assinatura para todo orçamento anterior a esta migração.
UPDATE "quotes" SET "responsible_user_id" = "created_by_id"
 WHERE "responsible_user_id" IS NULL;
