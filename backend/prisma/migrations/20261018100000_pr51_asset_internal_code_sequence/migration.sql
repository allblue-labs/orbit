-- PR-51 — o código interno do equipamento passa a ser gerado.
--
-- O recorte
-- -------------------------------------------------------------------------
-- `assets.identifier_type` diz o que é o conteúdo de `identifier`: número de
-- série, QR, NFC, código de barras, RFID. Todos esses são **lidos** da máquina
-- física, e gerar um deles inventaria um fato sobre o equipamento do cliente — um
-- QR que não existe em etiqueta nenhuma é uma busca que nunca encontra nada.
--
-- `INTERNAL_CODE` é o único que a organização atribui: é a etiqueta dela. Só esse
-- é gerado.
--
-- Por que o contador é por organização
-- -------------------------------------------------------------------------
-- A unicidade do identificador é `(organization_id, identifier)`, e a contagem
-- acompanha: cada inquilino começa no `EQP-000001`. Um contador global faria a
-- primeira máquina de um cliente novo nascer com o número de outra empresa — que
-- é vazamento de informação comercial numa etiqueta colada no equipamento.

CREATE TABLE "asset_internal_code_sequences" (
  "organization_id" UUID NOT NULL,
  "last_value"      INTEGER NOT NULL DEFAULT 0,
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "asset_internal_code_sequences_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "asset_internal_code_sequences_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Tabela interna e ainda assim do inquilino: num SaaS multi-tenant, um contador
-- sem política é uma linha que uma organização consegue ler da outra.
ALTER TABLE "asset_internal_code_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "asset_internal_code_sequences" FORCE ROW LEVEL SECURITY;

CREATE POLICY "asset_internal_code_sequences_tenant"
  ON "asset_internal_code_sequences"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR organization_id = app_current_organization_id()
  )
  WITH CHECK (
    app_is_platform_admin()
    OR organization_id = app_current_organization_id()
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "asset_internal_code_sequences" TO orbit_app;

-- O contador começa acima do maior código gerado que já exista naquela
-- organização.
--
-- É o que impede colisão com código digitado: quem etiquetou o parque antes de
-- usar o Orbit pode ter um `EQP-000007` à mão. Começando do máximo, todo código
-- gerado é maior que qualquer um já presente — e a criação em runtime ainda
-- avança se encontrar ocupado.
--
-- Só conta o sufixo numérico do formato gerado. Um código livre como
-- `EQP-TORRE-A` não entra na conta: não colide com `EQP-000008`, e interpretá-lo
-- como número empurraria o contador para longe.
--
-- Conta **todos** os equipamentos, inclusive apagados: o índice único
-- `(organization_id, identifier)` não tem predicado, então um registro em soft
-- delete continua ocupando o código.
INSERT INTO "asset_internal_code_sequences" ("organization_id", "last_value")
SELECT a."organization_id",
       COALESCE(
         MAX(
           CASE
             WHEN a."identifier" ~ '^EQP-[0-9]+$'
             THEN (substring(a."identifier" FROM '([0-9]+)$'))::INTEGER
           END
         ),
         0
       )
  FROM "assets" a
 GROUP BY a."organization_id"
    ON CONFLICT ("organization_id") DO NOTHING;

-- Nenhum equipamento existente recebe código nesta migração.
--
-- Diferente do SKU do catálogo, onde o campo era só um código e preenchê-lo é
-- ganho puro. Aqui `identifier` vem em par com `identifier_type`: atribuir um
-- código interno a um equipamento que hoje não tem tipo seria **decidir** que
-- aquela máquina é identificada por etiqueta interna, e isso é informação de
-- cadastro que ninguém deu. Equipamento sem identificação continua sem, e quem
-- quiser o código gerado escolhe o tipo "código interno" na edição.
