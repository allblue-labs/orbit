-- O dono da organização, habilitado também como Responsável Técnico.
--
-- Responsável Técnico não é o técnico que atende em campo: é quem responde
-- tecnicamente pelo PMOC e cuja assinatura sai no documento do contrato. São dois
-- papéis diferentes, e numa empresa de uma pessoa são a mesma pessoa.
--
-- O perfil do dono nascia com `technical_responsible_enabled` falso, pela regra geral
-- de que responsabilidade técnica é designação legal e não se presume. Para o dono a
-- conta é outra: a execução de PMOC exige um Responsável Técnico elegível para
-- começar, e nascer falso deixava o produto travado no primeiro plano — com o
-- interruptor escondido no perfil do próprio usuário.
--
-- O que isto afirma é a declaração de quem criou a conta, não a existência da
-- credencial: ela se cadastra no perfil profissional. A assinatura continua sendo
-- exigida de verdade na abertura da execução, onde o documento é produzido.
--
-- Só liga quem já tem perfil: criar perfil é assunto de `pr55`, e separar as duas
-- coisas deixa cada migração com uma pergunta.
UPDATE "professional_profiles" p
   SET "technical_responsible_enabled" = TRUE,
       "updated_at" = CURRENT_TIMESTAMP
  FROM "organizations" o
 WHERE o."id" = p."organization_id"
   AND o."owner_user_id" = p."user_id"
   AND o."deleted_at" IS NULL
   AND p."technical_responsible_enabled" = FALSE;
