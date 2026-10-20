-- PR-48 — cada equipamento tem a sua contagem de execuções.
--
-- O ciclo (`pmoc_executions`) já era numerado por plano: 1, 2, 3… até o fim da
-- vigência. O relatório de execução carregava esse número, e ele é o **mesmo
-- para todos os equipamentos do ciclo**.
--
-- Isso responde a pergunta errada. Quem lê um PMOC de um aparelho pergunta
-- "quantas manutenções esta máquina já teve neste contrato?" — e a resposta não
-- é o número do ciclo, porque um equipamento pode entrar no plano depois de ele
-- começar, ou ficar de fora de um ciclo por estar inativo. A partir daí o número
-- do ciclo e a contagem do aparelho divergem, e o relatório passa a afirmar uma
-- "execução 7" que é a terceira daquele equipamento.
--
-- Agora cada execução física carrega a sua própria posição na história daquele
-- equipamento dentro daquele plano.

/* ---------------------------------------------------------------- */
/* plan_id na execução física                                        */
/* ---------------------------------------------------------------- */

-- Denormalizado de propósito: sem ele a numeração por (plano, equipamento) não
-- pode ser garantida por índice, e uma garantia de unicidade que vive só no
-- código é uma garantia que a concorrência quebra.
--
-- O par sempre sai da mesma preparação que cria a linha, então não há caminho em
-- que ele discorde de `cycle.plan_id`.
ALTER TABLE "pmoc_equipment_executions" ADD COLUMN "plan_id" UUID;

UPDATE "pmoc_equipment_executions" AS e
   SET "plan_id" = c."plan_id"
  FROM "pmoc_executions" AS c
 WHERE c."id" = e."cycle_id";

ALTER TABLE "pmoc_equipment_executions" ALTER COLUMN "plan_id" SET NOT NULL;

ALTER TABLE "pmoc_equipment_executions"
  ADD CONSTRAINT "pmoc_equipment_executions_plan_fkey"
  FOREIGN KEY ("plan_id") REFERENCES "pmoc_plans"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

/* ---------------------------------------------------------------- */
/* A contagem por equipamento                                        */
/* ---------------------------------------------------------------- */

ALTER TABLE "pmoc_equipment_executions" ADD COLUMN "sequence_number" INTEGER;

-- O histórico recebe a numeração que ele teria tido: por (plano, equipamento),
-- na ordem em que as execuções começaram. `id` desempata — `started_at` tem
-- precisão de milissegundo e duas execuções do mesmo aparelho no mesmo
-- milissegundo produziriam empate, e `row_number()` precisa de ordem total.
WITH ordenado AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "plan_id", "asset_id"
      ORDER BY "started_at", "id"
    ) AS posicao
  FROM "pmoc_equipment_executions"
)
UPDATE "pmoc_equipment_executions" AS e
   SET "sequence_number" = ordenado.posicao
  FROM ordenado
 WHERE ordenado."id" = e."id";

ALTER TABLE "pmoc_equipment_executions"
  ALTER COLUMN "sequence_number" SET NOT NULL;

-- A autoridade contra duas execuções com o mesmo número para o mesmo
-- equipamento. É ela que torna `max(sequence_number)+1` seguro sob
-- concorrência: quem perder a corrida viola o índice em vez de repetir o número.
--
-- Escopo `(plano, equipamento)` e não `(cobertura, …)`: remover e readicionar um
-- equipamento cria **outra** linha de cobertura, e a contagem recomeçaria em 1
-- para a mesma máquina no mesmo contrato.
CREATE UNIQUE INDEX "pmoc_equipment_executions_sequence_unique"
  ON "pmoc_equipment_executions" ("plan_id", "asset_id", "sequence_number");

-- Consulta do relatório e da tela: a história de um equipamento no plano.
CREATE INDEX "pmoc_equipment_executions_asset_history_idx"
  ON "pmoc_equipment_executions" ("organization_id", "plan_id", "asset_id", "sequence_number");
