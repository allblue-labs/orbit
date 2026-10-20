-- PR-49 — a Ordem de Serviço passa a ter numeração própria.
--
-- O problema
-- -------------------------------------------------------------------------
-- O "Número" impresso na OS era `OS-<code>`, e `code` é o texto que o dono
-- digita ao criar a operação. Isso deixava três coisas erradas ao mesmo tempo:
-- o número da OS dependia da convenção de quem digitou, duas organizações
-- podiam ter formatos diferentes do mesmo documento legal, e — o pior — não
-- existia contagem de ordens de serviço.
--
-- Operação é o gênero: PMOC executa criando operação, RVT também. OS é uma
-- espécie. Contar operações para numerar OS misturaria as três, e a sequência
-- da OS de um cliente pularia números por causa de manutenções preventivas que
-- ele nunca viu como ordem de serviço.
--
-- A decisão
-- -------------------------------------------------------------------------
-- Um número inteiro por organização, próprio da OS, alocado quando a ordem
-- nasce — e **não** quando o documento é emitido: o número é como a operação é
-- chamada no telefone desde o primeiro dia, e não só depois de virar PDF.
--
-- Operações criadas pelo PMOC e pela RVT não recebem número: elas têm as
-- contagens delas, e consumir a da OS abriria buracos na sequência.

-- O contador, por organização.
--
-- Não é `MAX(service_order_number) + 1` calculado na aplicação: duas criações
-- simultâneas leriam o mesmo máximo, e uma das duas quebraria no índice único.
-- Não é uma SEQUENCE por organização: seriam objetos DDL criados em runtime.
-- É o mesmo padrão do contador de código do PMOC — uma linha por inquilino,
-- incrementada com `ON CONFLICT DO UPDATE` dentro da transação que cria a
-- ordem, atômica sob concorrência e sem reuso.
CREATE TABLE "service_order_sequences" (
  "organization_id" UUID NOT NULL,
  "last_value"      INTEGER NOT NULL DEFAULT 0,
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "service_order_sequences_pkey" PRIMARY KEY ("organization_id"),
  CONSTRAINT "service_order_sequences_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Tabela interna, e ainda assim do inquilino: a política não pode depender só
-- do predicado do repositório.
ALTER TABLE "service_order_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "service_order_sequences" FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_order_sequences_tenant" ON "service_order_sequences"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR organization_id = app_current_organization_id()
  )
  WITH CHECK (
    app_is_platform_admin()
    OR organization_id = app_current_organization_id()
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "service_order_sequences" TO orbit_app;

ALTER TABLE "operations" ADD COLUMN "service_order_number" INTEGER;

-- O índice é a autoridade, não o contador.
--
-- Parcial porque a maioria das operações não é OS — PMOC e RVT ficam com o
-- número nulo, e `NULL` não colide em índice único. Se um dia o contador for
-- restaurado de um backup mais antigo que a tabela de operações, é aqui que a
-- duplicidade é recusada, em vez de sair um segundo documento com o mesmo
-- número.
CREATE UNIQUE INDEX "operations_service_order_number_unique"
  ON "operations" ("organization_id", "service_order_number")
  WHERE "service_order_number" IS NOT NULL;

-- As ordens que já existem recebem número pela ordem em que nasceram.
--
-- `created_at` e, no empate, `id` — que é UUIDv7 e por isso monotônico: duas
-- ordens criadas no mesmo milissegundo continuam tendo uma ordem estável, e
-- rodar esta migração duas vezes em bancos diferentes dá o mesmo resultado.
--
-- Ficam de fora as operações que pertencem a PMOC ou a RVT: elas são operação,
-- não ordem de serviço, e numerá-las aqui faria a primeira OS da organização
-- nascer com um número alto e inexplicável.
WITH ordenado AS (
  SELECT o."id",
         row_number() OVER (
           PARTITION BY o."organization_id"
           ORDER BY o."created_at", o."id"
         ) AS posicao
    FROM "operations" o
   WHERE NOT EXISTS (
           SELECT 1 FROM "pmoc_executions" pe WHERE pe."operation_id" = o."id"
         )
     AND NOT EXISTS (
           SELECT 1 FROM "pmoc_equipment_executions" pq
            WHERE pq."operation_id" = o."id"
         )
     AND NOT EXISTS (
           SELECT 1 FROM "rvt_executions" re WHERE re."operation_id" = o."id"
         )
)
UPDATE "operations" o
   SET "service_order_number" = ordenado.posicao
  FROM ordenado
 WHERE ordenado."id" = o."id";

-- O contador nasce alinhado com o que a coluna acabou de receber. Sem isto, a
-- próxima OS criada pediria o número 1 e seria recusada pelo índice.
INSERT INTO "service_order_sequences" ("organization_id", "last_value")
SELECT o."organization_id", MAX(o."service_order_number")
  FROM "operations" o
 WHERE o."service_order_number" IS NOT NULL
 GROUP BY o."organization_id"
    ON CONFLICT ("organization_id") DO UPDATE
      SET "last_value" = GREATEST(
            "service_order_sequences"."last_value",
            EXCLUDED."last_value"
          );
