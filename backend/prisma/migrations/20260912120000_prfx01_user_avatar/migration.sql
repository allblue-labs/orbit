-- PR-FX-01 — foto de perfil do usuário.
--
-- Aditiva e mínima. A coluna guarda **referência** ao objeto de storage, nunca
-- o binário: manter a imagem no `users` transformaria toda leitura de usuário
-- num download, e a foto deixaria de ter o mesmo ciclo de vida (validação,
-- hash, URL temporária) que todo arquivo do produto já tem.
--
-- `avatar_url` continua existindo e não é tocada. Ela é a URL herdada de
-- provedor externo que algumas contas trazem; a foto enviada pelo produto vive
-- na referência nova, e é servida por URL assinada e temporária — nunca por um
-- endereço público permanente.

ALTER TABLE "users"
  ADD COLUMN "avatar_storage_file_id" UUID;

-- `SET NULL`, e não `CASCADE`: apagar o arquivo não pode apagar a pessoa. A
-- conta sobrevive à foto, e volta a mostrar as iniciais.
ALTER TABLE "users"
  ADD CONSTRAINT "users_avatar_storage_file_id_fkey"
  FOREIGN KEY ("avatar_storage_file_id")
  REFERENCES "storage_files" ("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Parcial: a esmagadora maioria das linhas não tem foto, e um índice sobre
-- nulos ocuparia espaço para não responder pergunta nenhuma. Ele existe para
-- a limpeza de storage — "que usuários apontam para este arquivo?".
CREATE INDEX "users_avatar_storage_file_idx"
  ON "users" ("avatar_storage_file_id")
  WHERE "avatar_storage_file_id" IS NOT NULL;
