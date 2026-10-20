-- Participação de quem já estava atribuído.
--
-- Há duas representações da mesma informação. `operation_users` é a tabela genérica
-- de "quem está neste atendimento", e é dela que saem o relatório de equipe e os KPIs
-- de produtividade. `operations.responsible_field_technician_id` e
-- `operation_auxiliary_technicians` dizem **em qual papel** — é o modelo que o
-- aplicativo de campo filtra.
--
-- A criação direta de operação gravava só o segundo. O efeito era um atendimento com
-- técnico atribuído, aparecendo no celular dele, que a listagem mostrava como "Sem
-- técnico" e o relatório de equipe contava como zero atribuições. O PMOC sempre
-- gravou as duas coisas; faltava nesta porta, e o código passou a gravar.
--
-- Isto cuida do que já existe: sem o backfill, os atendimentos atribuídos até agora
-- seguiriam fora do relatório de equipe — e a correção pareceria não ter funcionado
-- para quem olhar o histórico.
--
-- `ON CONFLICT DO NOTHING` porque a pessoa pode já constar por outro caminho: a rota
-- `assign`, ou uma execução de PMOC. A única `(operation_id, user_id)` é a autoridade.
-- Sem coluna `id`: a chave desta tabela é o par `(operation_id, user_id)`, que é
-- também o que impede a mesma pessoa de constar duas vezes no mesmo atendimento.
INSERT INTO "operation_users" ("operation_id", "user_id", "assigned_by_id", "assigned_at")
SELECT o."id",
  o."responsible_field_technician_id",
  -- Quem criou a operação é quem atribuiu: é a única autoria que o registro guarda
  -- para uma atribuição feita no próprio formulário de criação.
  o."created_by_id",
  o."created_at"
  FROM "operations" o
 WHERE o."deleted_at" IS NULL
   AND o."responsible_field_technician_id" IS NOT NULL
ON CONFLICT ("operation_id", "user_id") DO NOTHING;

-- Os auxiliares, pela mesma razão: a pergunta do relatório é "quantos atendimentos
-- esta pessoa tem", e quem acompanha tem. Só os vigentes — `removed_at` nulo é o que
-- separa "é auxiliar" de "já foi".
INSERT INTO "operation_users" ("operation_id", "user_id", "assigned_by_id", "assigned_at")
SELECT a."operation_id",
  a."user_id",
  a."assigned_by_id",
  a."assigned_at"
  FROM "operation_auxiliary_technicians" a
  JOIN "operations" o ON o."id" = a."operation_id"
 WHERE a."removed_at" IS NULL
   AND o."deleted_at" IS NULL
ON CONFLICT ("operation_id", "user_id") DO NOTHING;
