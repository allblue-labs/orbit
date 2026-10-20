-- O técnico em campo pode ver quanto o atendimento vale?
--
-- `false` para todos, inclusive para o que já existe. Não é cautela genérica: o
-- padrão oposto revelaria, no instante da migração, o valor combinado de todo
-- atendimento em aberto a quem estiver com o aplicativo na mão — uma decisão de
-- negócio tomada por um `ALTER TABLE`.
--
-- O número não está aqui. O valor do atendimento é o total do orçamento vinculado
-- (`quotes.operation_id`); esta coluna governa quem o vê.
ALTER TABLE "operations"
  ADD COLUMN "amount_visible_in_field" BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN "operations"."amount_visible_in_field" IS
  'Libera o total do orçamento vinculado para o aplicativo de campo. Não guarda valor.';
