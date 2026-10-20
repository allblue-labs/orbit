-- PR-52 — o recibo ganha numeração própria, por organização.
--
-- Por que o recibo precisa de número
-- -------------------------------------------------------------------------
-- Ele é o único documento da série que prova um fato jurídico: depois de
-- assinado, quem pagou tem como provar que pagou. É citado em conversa de
-- cobrança, em conciliação e, quando dá briga, em juízo — e para ser citado
-- precisa de um nome curto que não dependa de quem digitou.
--
-- A execução de artefato exige `code` único por organização
-- (`@@unique([organization_id, code])`). Sem contador, a tela teria de inventar
-- um código no navegador: dois recibos emitidos no mesmo minuto colidiriam, e o
-- segundo receberia 409 depois de a pessoa preencher o formulário inteiro.
--
-- Independente das outras contagens — ordem de serviço, SKU, código interno de
-- equipamento. Recibo é outro fluxo, e somá-lo a qualquer um deles faria o
-- primeiro recibo da organização nascer com um número que ninguém explica.

CREATE TABLE "receipt_sequences" (
  "organization_id" UUID NOT NULL,
  "last_value"      INTEGER NOT NULL DEFAULT 0,
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "receipt_sequences_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "receipt_sequences_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Tabela interna e ainda assim do inquilino: num SaaS multi-tenant, um contador
-- sem política é uma linha que uma organização lê da outra.
ALTER TABLE "receipt_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "receipt_sequences" FORCE ROW LEVEL SECURITY;

CREATE POLICY "receipt_sequences_tenant" ON "receipt_sequences"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR organization_id = app_current_organization_id()
  )
  WITH CHECK (
    app_is_platform_admin()
    OR organization_id = app_current_organization_id()
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "receipt_sequences" TO orbit_app;

-- O contador começa acima do maior código de recibo que já exista.
--
-- Recibos emitidos antes desta numeração têm código livre — derivado de outro
-- registro ou digitado. Só conta como sequência o sufixo numérico do formato
-- gerado (`RC-000007`); um código como `RC-CLIENTE-A` não colide com ele, e
-- interpretá-lo como número empurraria o contador para longe.
--
-- O recorte é pelo **snapshot**, não pelo template: o tipo do documento emitido
-- é o que ficou congelado nele, e um template renomeado depois não reescreve o
-- que já saiu. É o mesmo critério que o filtro da listagem usa.
INSERT INTO "receipt_sequences" ("organization_id", "last_value")
SELECT e."organization_id",
       COALESCE(
         MAX(
           CASE
             WHEN e."code" ~ '^RC-[0-9]+$'
             THEN (substring(e."code" FROM '([0-9]+)$'))::INTEGER
           END
         ),
         0
       )
  FROM "artifact_executions" e
  JOIN "artifact_snapshots" s ON s."id" = e."snapshot_id"
 WHERE upper(s."artifact_type") = 'RECIBO'
 GROUP BY e."organization_id"
    ON CONFLICT ("organization_id") DO NOTHING;
