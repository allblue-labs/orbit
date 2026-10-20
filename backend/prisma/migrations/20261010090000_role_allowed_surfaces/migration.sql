-- Onde cada papel pode entrar.
--
-- O tecnico operacional e o auxiliar existem para o aplicativo de campo; o
-- painel web e da administracao da operacao. Nao havia nada separando as duas
-- superficies: quem recebia a senha temporaria para o celular entrava no
-- painel e enxergava a organizacao inteira.
--
-- O padrao e permissivo de proposito. Papeis que ja existem continuam como
-- estao — inclusive os personalizados que cada dono criou, sobre os quais esta
-- migracao nao tem opiniao. So os dois papeis de campo semeados sao
-- restringidos, e por chave, porque e deles que se sabe a intencao.

ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "allowed_surfaces" VARCHAR(10)[] NOT NULL DEFAULT ARRAY['WEB','MOBILE']::VARCHAR(10)[];

-- Os dois papeis de campo passam a ser so do aplicativo.
UPDATE "roles"
   SET "allowed_surfaces" = ARRAY['MOBILE']::VARCHAR(10)[]
 WHERE "key" IN ('FIELD_TECHNICIAN', 'ASSISTANT_TECHNICIAN')
   AND "allowed_surfaces" = ARRAY['WEB','MOBILE']::VARCHAR(10)[];

-- Uma superficie ao menos, e so as que existem.
--
-- Sem isto um papel podia ficar com o vetor vazio e ninguem conseguiria entrar
-- com ele em lugar nenhum — uma conta trancada sem mensagem que explicasse.
ALTER TABLE "roles"
  DROP CONSTRAINT IF EXISTS "roles_allowed_surfaces_valid";
ALTER TABLE "roles"
  ADD CONSTRAINT "roles_allowed_surfaces_valid" CHECK (
    cardinality("allowed_surfaces") > 0
    AND "allowed_surfaces" <@ ARRAY['WEB','MOBILE','API']::VARCHAR(10)[]
  );
