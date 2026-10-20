-- Vincula um modelo de checklist a um tipo de atendimento.
--
-- Nulo = serve a qualquer tipo, que e o que todo modelo existente era antes
-- desta coluna. Por isso a coluna nasce anulavel e sem valor padrao: nenhum
-- modelo ja cadastrado muda de comportamento.
ALTER TABLE "checklist_templates"
  ADD COLUMN "operation_kind" VARCHAR(40);

-- O caminho de leitura novo e "o checklist ativo deste tipo, nesta
-- organizacao" — a mesma forma do indice que ja existia, com o tipo no meio.
CREATE INDEX "checklist_templates_organization_id_operation_kind_is_active_deleted_at_idx"
  ON "checklist_templates" ("organization_id", "operation_kind", "is_active", "deleted_at");
