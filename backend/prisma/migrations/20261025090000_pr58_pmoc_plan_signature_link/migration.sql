-- Link temporário para o contratante ler e assinar o contrato do PMOC.
--
-- ## Por que uma tabela, e não um token assinado
--
-- Porque o que o contrato precisa responder depois não é "este token é válido", e sim
-- "quem assinou, quando, de onde". Isso é linha de banco. A assinatura coletada vive
-- aqui, e é daqui que o documento do PMOC a lê.
--
-- ## O token não é guardado
--
-- Só o SHA-256 dele, como em `customer_portal_invitations`. Vazando o banco, ninguém
-- assina em nome de ninguém: o segredo existe uma vez, na resposta que o dono copia.
CREATE TABLE "pmoc_plan_signature_links" (
  "id"                 UUID         PRIMARY KEY,
  "organization_id"    UUID         NOT NULL,
  "plan_id"            UUID         NOT NULL,
  "token_hash"         CHAR(64)     NOT NULL,
  "expires_at"         TIMESTAMPTZ(3) NOT NULL,
  "created_by_id"      UUID         NOT NULL,
  "revoked_at"         TIMESTAMPTZ(3),
  "signed_at"          TIMESTAMPTZ(3),
  "signer_name"        VARCHAR(180),
  "signer_document"    VARCHAR(40),
  "signer_email"       VARCHAR(180),
  "signed_ip"          VARCHAR(64),
  "signed_user_agent"  VARCHAR(400),
  "signature_file_id"  UUID,
  "signature_sha256"   CHAR(64),
  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pmoc_plan_signature_links_organization_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "pmoc_plan_signature_links_plan_fk"
    FOREIGN KEY ("plan_id") REFERENCES "pmoc_plans"("id") ON DELETE CASCADE,
  CONSTRAINT "pmoc_plan_signature_links_created_by_fk"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "pmoc_plan_signature_links_file_fk"
    FOREIGN KEY ("signature_file_id") REFERENCES "storage_files"("id") ON DELETE RESTRICT,

  -- Assinado é assinado por inteiro: data, nome e arquivo chegam juntos, ou nenhum
  -- chega. Sem isto, uma escrita parcial produziria um contrato "assinado" sem
  -- assinatura — pior que não assinado, porque parece válido.
  CONSTRAINT "pmoc_plan_signature_links_signed_complete" CHECK (
    ("signed_at" IS NULL AND "signature_file_id" IS NULL AND "signer_name" IS NULL)
    OR
    ("signed_at" IS NOT NULL AND "signature_file_id" IS NOT NULL AND "signer_name" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "pmoc_plan_signature_links_token_hash_key"
  ON "pmoc_plan_signature_links" ("token_hash");

-- Um link **pendente** por plano.
--
-- Gerar um novo revoga o anterior, e o índice é o que garante isso de verdade: duas
-- requisições simultâneas passariam por qualquer verificação em aplicação, e aí o
-- contrato teria dois links vivos — um deles circulando por e-mail depois de o dono
-- ter decidido gerar outro.
--
-- Parcial de propósito: links revogados e links já assinados ficam como histórico e
-- não bloqueiam uma coleta nova.
CREATE UNIQUE INDEX "pmoc_signature_links_pending_unique"
  ON "pmoc_plan_signature_links" ("plan_id")
  WHERE "revoked_at" IS NULL AND "signed_at" IS NULL;

CREATE INDEX "pmoc_plan_signature_links_org_plan_idx"
  ON "pmoc_plan_signature_links" ("organization_id", "plan_id", "created_at");
CREATE INDEX "pmoc_plan_signature_links_signed_idx"
  ON "pmoc_plan_signature_links" ("plan_id", "signed_at");

-- RLS como em toda tabela de inquilino. A rota pública lê por `token_hash` fora de
-- contexto de organização, e é por isso que ela usa a conexão de plataforma: o token
-- é a credencial, e a política de inquilino não teria como ser satisfeita por alguém
-- que não tem sessão.
ALTER TABLE "pmoc_plan_signature_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pmoc_plan_signature_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "pmoc_plan_signature_links_tenant" ON "pmoc_plan_signature_links" FOR ALL
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "pmoc_plan_signature_links" TO orbit_app;
