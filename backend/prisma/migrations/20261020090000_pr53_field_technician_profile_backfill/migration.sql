-- Perfil profissional para quem já foi cadastrado como técnico.
--
-- A lista de técnicos do formulário de operação lê `professional_profiles`, e o
-- cadastro de membro nunca criava essa linha. O efeito não era cosmético:
-- `validateTechnicianAssignments` recusa quem não está lá, então atribuir um
-- atendimento a um técnico recém-cadastrado era impossível — o seletor abria
-- vazio e não havia nada na tela dizendo o que faltava.
--
-- O cadastro passou a criar o perfil. Isto cuida de quem já existe: sem o
-- backfill, a correção só valeria para quem for cadastrado a partir de agora, e
-- as equipes já montadas continuariam inatribuíveis.
--
-- A regra é a mesma do código (`field-eligibility.ts`): o acesso concedido abre o
-- aplicativo de campo **e** permite alterar a etapa do atendimento. Derivada do
-- acesso e não da chave do papel, porque o dono cria papéis próprios — um `IN
-- ('FIELD_TECHNICIAN')` aqui deixaria de fora o "Ajudante" que ele cadastrou.
--
-- `technical_responsible_enabled` fica falso: é designação legal com credencial
-- de conselho atrás, e deduzi-la de permissões afirmaria o que o RBAC não sabe.
--
-- Conservador de propósito: `DO NOTHING` em conflito. Quem já tem perfil tem uma
-- decisão humana registrada — inclusive a de ter desligado o próprio técnico —, e
-- um backfill não desfaz decisão de ninguém.
INSERT INTO "professional_profiles" (
  "id", "organization_id", "user_id", "field_technician_enabled",
  "technical_responsible_enabled", "active", "created_at", "updated_at"
)
SELECT (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  m."organization_id", m."user_id", TRUE, FALSE, TRUE,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "organization_memberships" m
  JOIN "roles" r ON r."id" = m."role_id"
  JOIN "users" u ON u."id" = m."user_id"
 WHERE m."status" = 'ACTIVE'
   AND m."deleted_at" IS NULL
   AND u."status" = 'ACTIVE'
   AND u."deleted_at" IS NULL
   -- O override do membro substitui o papel inteiro quando existe; é a mesma
   -- resolução de `grantedAccessOf` e de `surfacesOf`, não uma segunda leitura.
   AND 'MOBILE' = ANY(
     CASE WHEN m."uses_custom_access"
       THEN m."custom_allowed_surfaces"
       ELSE r."allowed_surfaces"
     END
   )
   AND 'operations.status.update' = ANY(
     CASE WHEN m."uses_custom_access"
       THEN m."custom_permissions"
       ELSE r."permissions"
     END
   )
ON CONFLICT ("organization_id", "user_id") DO NOTHING;
