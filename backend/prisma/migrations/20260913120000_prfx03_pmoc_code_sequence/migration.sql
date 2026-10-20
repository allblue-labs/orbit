-- PR-FX-03 — sequência de código do PMOC, por cliente.
--
-- Por que uma tabela, e não COUNT(*) + 1
-- -------------------------------------------------------------------------
-- A unicidade do código é parcial: `pmoc_plans_code_unique_active` só vale
-- onde `deleted_at IS NULL`. Contar planos para chegar ao próximo número
-- devolveria um número já usado assim que alguém apagasse um plano, e o
-- histórico passaria a ter dois `PMOC-CLIENTE-003` diferentes.
--
-- Também não é uma SEQUENCE do PostgreSQL por cliente: seriam objetos DDL
-- criados em runtime, um por cliente, que nenhum backup ou migration
-- consegue acompanhar.
--
-- É um contador persistido, incrementado dentro da transação do create com
-- `ON CONFLICT DO UPDATE`, que é atômico sob concorrência e nunca reutiliza.
CREATE TABLE "pmoc_code_sequences" (
  "organization_id" UUID NOT NULL,
  "customer_id"     UUID NOT NULL,
  "last_value"      INTEGER NOT NULL DEFAULT 0,
  "updated_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "pmoc_code_sequences_pkey"
    PRIMARY KEY ("organization_id", "customer_id")
);

ALTER TABLE "pmoc_code_sequences"
  ADD CONSTRAINT "pmoc_code_sequences_organization_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pmoc_code_sequences"
  ADD CONSTRAINT "pmoc_code_sequences_customer_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- O contador nasce alinhado com o que já existe.
--
-- Idempotente e não destrutivo: só semeia clientes que já têm plano.
--
-- A extração é deliberadamente estreita. Só conta como número de sequência o
-- sufixo `-NNN` com até quatro dígitos, que é o formato sugerido. Um código
-- livre terminado em `-20260913` é data, não sequência: contá-lo empurraria o
-- contador para vinte milhões e estouraria o `integer`. Quando nada casa, o
-- contador começa em zero e o primeiro sugerido é `001` — e, se `001` já
-- estiver ocupado por um código livre, o create avança até achar um livre.
INSERT INTO "pmoc_code_sequences" ("organization_id", "customer_id", "last_value")
SELECT p."organization_id",
       p."customer_id",
       COALESCE(MAX((substring(p."code" FROM '-([0-9]{1,4})$'))::INTEGER), 0)
  FROM "pmoc_plans" p
 GROUP BY p."organization_id", p."customer_id"
    ON CONFLICT ("organization_id", "customer_id") DO NOTHING;
