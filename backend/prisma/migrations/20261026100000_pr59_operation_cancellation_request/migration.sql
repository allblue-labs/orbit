-- O pedido de cancelamento feito em campo.
--
-- Quem está na porta descobre que não dá para atender — ninguém no local, acesso
-- negado, equipamento inacessível. Isso precisa de desfecho imediato para o técnico
-- e nenhuma autoridade para encerrar o compromisso: cancelar é decisão comercial, e
-- o dono pode preferir remarcar ou mandar outra pessoa.
--
-- Por isso é registro próprio, e não um estado da operação: ela segue viva enquanto
-- o dono não decide.

CREATE TABLE "operation_cancellation_requests" (
  "id"               UUID PRIMARY KEY,
  "organization_id"  UUID        NOT NULL,
  "business_unit_id" UUID        NOT NULL,
  "operation_id"     UUID        NOT NULL,
  "reason"           TEXT        NOT NULL,
  "requested_by_id"  UUID        NOT NULL,
  "requested_at"     TIMESTAMPTZ(3) NOT NULL,
  "status"           VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "resolution"       VARCHAR(20),
  "resolution_notes" TEXT,
  "resolved_by_id"   UUID,
  "resolved_at"      TIMESTAMPTZ(3),
  "created_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

  CONSTRAINT "ocr_organization_fk" FOREIGN KEY ("organization_id")
    REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "ocr_business_unit_fk" FOREIGN KEY ("business_unit_id")
    REFERENCES "business_units"("id") ON DELETE RESTRICT,
  CONSTRAINT "ocr_operation_fk" FOREIGN KEY ("operation_id")
    REFERENCES "operations"("id") ON DELETE CASCADE,
  CONSTRAINT "ocr_requested_by_fk" FOREIGN KEY ("requested_by_id")
    REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "ocr_resolved_by_fk" FOREIGN KEY ("resolved_by_id")
    REFERENCES "users"("id") ON DELETE SET NULL,

  CONSTRAINT "ocr_status_check" CHECK ("status" IN ('PENDING','RESOLVED')),
  CONSTRAINT "ocr_resolution_check" CHECK (
    "resolution" IS NULL
    OR "resolution" IN ('CANCELLED','RESCHEDULED','REASSIGNED','DISMISSED')
  ),

  -- A justificativa é o que o dono lê para decidir. Em branco, o pedido não diz
  -- nada e o cancelamento vira estatística sem causa.
  CONSTRAINT "ocr_reason_present" CHECK (btrim("reason") <> ''),

  -- Resolvido é tudo ou nada: quem decidiu, quando e o quê andam juntos. Meio
  -- resolvido deixaria um pedido fechado sem autor, e ninguém a quem perguntar.
  CONSTRAINT "ocr_resolution_complete" CHECK (
    ("status" = 'PENDING'
       AND "resolution" IS NULL AND "resolved_by_id" IS NULL AND "resolved_at" IS NULL)
    OR
    ("status" = 'RESOLVED'
       AND "resolution" IS NOT NULL AND "resolved_at" IS NOT NULL)
  )
);

-- Um pedido pendente por atendimento.
--
-- Parcial, e não único na coluna: o mesmo atendimento pode acumular pedidos ao longo
-- do tempo — remarcado, tentado de novo, recusado de novo —, e o histórico é o que
-- mostra um cliente que nunca está no local. O que não pode haver são dois pendentes
-- ao mesmo tempo, que dariam ao dono duas versões para resolver.
CREATE UNIQUE INDEX "ocr_pending_unique"
  ON "operation_cancellation_requests" ("operation_id")
  WHERE "status" = 'PENDING';

CREATE INDEX "ocr_org_status_idx"
  ON "operation_cancellation_requests" ("organization_id", "status", "requested_at");
CREATE INDEX "ocr_operation_idx"
  ON "operation_cancellation_requests" ("operation_id", "requested_at");

ALTER TABLE "operation_cancellation_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "operation_cancellation_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY "operation_cancellation_requests_tenant" ON "operation_cancellation_requests" FOR ALL
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "operation_cancellation_requests" TO orbit_app;

-- A foto apresentada junto do pedido.
--
-- A evidência continua sendo da operação: o alvo não muda e o pipeline de upload é o
-- mesmo. Esta coluna só registra que a foto foi citada como justificativa, para o
-- dono ver as que importam em vez de todas as do atendimento.
ALTER TABLE "field_evidence"
  ADD COLUMN "cancellation_request_id" UUID,
  ADD CONSTRAINT "field_evidence_cancellation_request_fk"
    FOREIGN KEY ("cancellation_request_id")
    REFERENCES "operation_cancellation_requests"("id") ON DELETE SET NULL;

CREATE INDEX "field_evidence_cancellation_request_idx"
  ON "field_evidence" ("cancellation_request_id");
