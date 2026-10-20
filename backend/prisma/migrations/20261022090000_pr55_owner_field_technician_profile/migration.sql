-- O dono da organização, habilitado como técnico de campo.
--
-- No primeiro dia a organização é uma pessoa: quem criou a conta é quem vai ao
-- local, assina o PMOC e responde pelo atendimento. Sem um `professional_profiles`
-- próprio ele não aparecia em nenhum seletor de técnico — nem na atribuição de
-- operação, nem no responsável operacional do PMOC.
--
-- O curinga de permissões do dono não cobre isso: o perfil profissional é requisito
-- de domínio separado do RBAC, e ter todas as permissões não torna ninguém
-- profissional. É a mesma razão pela qual `seed-owner` já criava o perfil do
-- inquilino de teste à mão.
--
-- A criação de organização passou a gravar o perfil. Isto cuida de quem já existe.
--
-- `DO NOTHING` em conflito: um dono que já tem perfil tem uma decisão humana
-- registrada — inclusive a de ter desligado a si mesmo —, e backfill não desfaz
-- decisão de ninguém.
INSERT INTO "professional_profiles" (
  "id", "organization_id", "user_id", "field_technician_enabled",
  "technical_responsible_enabled", "active", "created_at", "updated_at"
)
SELECT (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  o."id", o."owner_user_id", TRUE, FALSE, TRUE,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "organizations" o
  JOIN "users" u ON u."id" = o."owner_user_id"
 WHERE o."deleted_at" IS NULL
   AND u."deleted_at" IS NULL
   AND u."status" = 'ACTIVE'
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
