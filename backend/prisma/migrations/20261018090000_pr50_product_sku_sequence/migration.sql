-- PR-50 — o SKU do catálogo passa a ser gerado, com contagem por fluxo.
--
-- O problema
-- -------------------------------------------------------------------------
-- O campo era opcional e ninguém o preenchia: todo item nascia sem código. O
-- catálogo alimenta orçamento, estoque e ordem de serviço, e o SKU é como as
-- pessoas se referem a um item quando não estão olhando a tela — no telefone com
-- o fornecedor, na conferência do almoxarifado, na conversa sobre o que foi
-- aplicado num atendimento.
--
-- Por que uma contagem por fluxo
-- -------------------------------------------------------------------------
-- Produto, serviço e peça são catálogos diferentes na mesma tabela, separados
-- por `kind`. Uma sequência única faria o primeiro serviço da organização nascer
-- como o número 47 porque existem 46 produtos, e ninguém consegue explicar isso
-- para quem está montando a lista de serviços.

CREATE TABLE "product_sku_sequences" (
  "organization_id" UUID NOT NULL,
  -- O fluxo: `PRODUCT`, `SERVICE`, `PART`. Texto, como a coluna de `products`:
  -- um fluxo novo entra sem migração de enum.
  "kind"            VARCHAR(40) NOT NULL,
  "last_value"      INTEGER NOT NULL DEFAULT 0,
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "product_sku_sequences_pkey"
    PRIMARY KEY ("organization_id", "kind"),
  CONSTRAINT "product_sku_sequences_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Tabela interna e ainda assim do inquilino: a política não pode depender só do
-- predicado do repositório.
ALTER TABLE "product_sku_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_sku_sequences" FORCE ROW LEVEL SECURITY;

CREATE POLICY "product_sku_sequences_tenant" ON "product_sku_sequences"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR organization_id = app_current_organization_id()
  )
  WITH CHECK (
    app_is_platform_admin()
    OR organization_id = app_current_organization_id()
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "product_sku_sequences" TO orbit_app;

-- O contador começa **acima** do maior código já usado naquele fluxo.
--
-- É o que impede a colisão com código digitado: quem importou o catálogo antigo
-- pode ter um `PRD-000007` à mão, e gerar a partir de 1 tropeçaria nele no índice
-- único. Começando do máximo, todo código gerado é maior que qualquer um que já
-- exista — e a criação em runtime ainda avança se encontrar ocupado.
--
-- Só conta como sequência o sufixo numérico do formato gerado (`PRD-000007`). Um
-- código livre como `PRD-CX-ALPHA` não entra na conta: não colide com o formato
-- gerado, e interpretá-lo como número empurraria o contador para longe.
INSERT INTO "product_sku_sequences" ("organization_id", "kind", "last_value")
SELECT p."organization_id",
       p."kind",
       COALESCE(
         MAX(
           CASE
             WHEN p."sku" ~ ('^' || CASE p."kind"
                                      WHEN 'PRODUCT' THEN 'PRD'
                                      WHEN 'SERVICE' THEN 'SRV'
                                      WHEN 'PART'    THEN 'PEC'
                                      ELSE 'ITM'
                                    END || '-[0-9]+$')
             THEN (substring(p."sku" FROM '([0-9]+)$'))::INTEGER
           END
         ),
         0
       )
  FROM "products" p
 GROUP BY p."organization_id", p."kind"
    ON CONFLICT ("organization_id", "kind") DO NOTHING;

-- Os itens que já existem recebem código pela ordem em que nasceram.
--
-- `created_at` e, no empate, `id` — que é UUIDv7 e por isso monotônico: duas
-- criações no mesmo milissegundo continuam tendo ordem estável, e rodar esta
-- migração em bancos diferentes dá o mesmo resultado.
--
-- Item apagado (soft delete) também recebe: a unicidade do SKU não distingue
-- apagado, então pular esses liberaria números que o índice ainda considera
-- ocupados quando alguém restaurar o registro.
WITH numerado AS (
  SELECT p."id",
         p."organization_id",
         p."kind",
         s."last_value" + row_number() OVER (
           PARTITION BY p."organization_id", p."kind"
           ORDER BY p."created_at", p."id"
         ) AS sequencia
    FROM "products" p
    JOIN "product_sku_sequences" s
      ON s."organization_id" = p."organization_id"
     AND s."kind" = p."kind"
   WHERE p."sku" IS NULL
)
UPDATE "products" p
   SET "sku" = CASE numerado."kind"
                 WHEN 'PRODUCT' THEN 'PRD'
                 WHEN 'SERVICE' THEN 'SRV'
                 WHEN 'PART'    THEN 'PEC'
                 ELSE 'ITM'
               END || '-' || lpad(numerado.sequencia::TEXT, 6, '0')
  FROM numerado
 WHERE numerado."id" = p."id";

-- O contador acompanha o que a coluna acabou de receber. Sem isto, a próxima
-- criação pediria um número já gravado e avançaria um por um até achar livre —
-- funcionaria, e faria uma consulta por item existente.
UPDATE "product_sku_sequences" s
   SET "last_value" = GREATEST(s."last_value", usado.maximo),
       "updated_at" = now()
  FROM (
    SELECT p."organization_id",
           p."kind",
           MAX((substring(p."sku" FROM '([0-9]+)$'))::INTEGER) AS maximo
      FROM "products" p
     WHERE p."sku" ~ ('^' || CASE p."kind"
                               WHEN 'PRODUCT' THEN 'PRD'
                               WHEN 'SERVICE' THEN 'SRV'
                               WHEN 'PART'    THEN 'PEC'
                               ELSE 'ITM'
                             END || '-[0-9]+$')
     GROUP BY p."organization_id", p."kind"
  ) AS usado
 WHERE usado."organization_id" = s."organization_id"
   AND usado."kind" = s."kind";
