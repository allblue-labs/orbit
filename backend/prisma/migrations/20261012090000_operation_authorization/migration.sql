-- Autorizacao da atribuicao, de verdade.
--
-- A preferencia `settings.operations.requireAssignmentAuthorization` era
-- gravada desde a PR-12 e **nenhum ponto do backend a lia**. Ligar a chave nao
-- escondia nada de ninguem: o tecnico continuava vendo tudo pelo aplicativo e
-- pela API, e a tela dizia isso com todas as letras para nao fingir um fluxo
-- que nao acontecia.
--
-- Agora o atendimento carrega quando foi autorizado e por quem, e a fila de
-- campo passa a filtrar.

ALTER TABLE "operations"
  ADD COLUMN IF NOT EXISTS "authorized_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "authorized_by_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operations_authorized_by_id_fkey'
  ) THEN
    ALTER TABLE "operations"
      ADD CONSTRAINT "operations_authorized_by_id_fkey"
      FOREIGN KEY ("authorized_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Tudo o que ja existe nasce autorizado.
--
-- Ligar a chave amanha nao pode esconder retroativamente o trabalho de hoje:
-- a operacao chegaria de manha com a fila vazia e nenhuma explicacao. O
-- carimbo usa a criacao do proprio atendimento, que e a verdade mais proxima
-- — nao `now()`, que fabricaria uma autorizacao que ninguem deu hoje.
UPDATE "operations"
   SET "authorized_at" = "created_at"
 WHERE "authorized_at" IS NULL;

CREATE INDEX IF NOT EXISTS "operations_organization_id_authorized_at_idx"
  ON "operations" ("organization_id", "authorized_at");
