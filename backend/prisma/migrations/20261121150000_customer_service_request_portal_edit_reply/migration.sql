-- ORBIT V2 — Chamados do cliente: mais informação, edição e resposta.
--
-- 1. `urgency` e `details`: o que o técnico precisa saber antes de sair —
--    quão urgente é, se o equipamento parou, onde fica, quando dá para ir e
--    com quem falar. Tudo opcional para o cliente; `urgency` tem padrão.
-- 2. O cliente passa a poder EDITAR o chamado enquanto ninguém o triou
--    (`OPEN`), e RESPONDER enquanto ele estiver vivo. Antes só cancelava.
--
-- O banco continua sendo a barreira: o trigger aceita do portal exatamente três
-- formas de atualização — cancelar, editar o conteúdo em `OPEN`, responder — e
-- recusa qualquer outra. A policy de UPDATE deixa de exigir `CANCELLED`, e o
-- trigger passa a decidir a forma.

ALTER TABLE "customer_service_requests"
  ADD COLUMN "urgency" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "details" JSONB NOT NULL DEFAULT '{}',
  ADD CONSTRAINT "csr_urgency_check"
    CHECK ("urgency" IN ('LOW','NORMAL','HIGH','URGENT')),
  ADD CONSTRAINT "csr_details_object_check"
    CHECK (jsonb_typeof("details") = 'object');

CREATE INDEX "csr_org_status_urgency_idx"
  ON "customer_service_requests"("organization_id", "status", "urgency", "submitted_at");

CREATE OR REPLACE FUNCTION app_guard_customer_service_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  v_identidade_igual boolean;
  v_conteudo_igual boolean;
  v_cancelar boolean;
  v_editar boolean;
  v_responder boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "customer_portal_identities" i
    WHERE i."id" = NEW."created_by_portal_identity_id"
      AND i."organization_id" = NEW."organization_id"
      AND i."customer_id" = NEW."customer_id"
  ) THEN
    RAISE EXCEPTION 'customer service request identity scope mismatch' USING ERRCODE = '23514';
  END IF;

  IF NEW."asset_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "assets" a
    WHERE a."id" = NEW."asset_id"
      AND a."organization_id" = NEW."organization_id"
      AND a."customer_id" = NEW."customer_id"
      AND a."business_unit_id" = NEW."business_unit_id"
      AND a."deleted_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'customer service request asset scope mismatch' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND app_current_actor_type() = 'CUSTOMER_PORTAL' THEN
    -- O que nunca muda pelo portal, em nenhuma das três formas.
    v_identidade_igual :=
          NEW."version" = OLD."version" + 1
      AND OLD."converted_operation_id" IS NULL
      AND NEW."organization_id" IS NOT DISTINCT FROM OLD."organization_id"
      AND NEW."customer_id" IS NOT DISTINCT FROM OLD."customer_id"
      AND NEW."created_by_portal_identity_id" IS NOT DISTINCT FROM OLD."created_by_portal_identity_id"
      AND NEW."code" IS NOT DISTINCT FROM OLD."code"
      AND NEW."assigned_to_user_id" IS NOT DISTINCT FROM OLD."assigned_to_user_id"
      AND NEW."converted_operation_id" IS NOT DISTINCT FROM OLD."converted_operation_id"
      AND NEW."create_idempotency_key" IS NOT DISTINCT FROM OLD."create_idempotency_key"
      AND NEW."create_payload_hash" IS NOT DISTINCT FROM OLD."create_payload_hash"
      AND NEW."submitted_at" IS NOT DISTINCT FROM OLD."submitted_at"
      AND NEW."created_at" IS NOT DISTINCT FROM OLD."created_at"
      AND NEW."conversion_idempotency_key" IS NOT DISTINCT FROM OLD."conversion_idempotency_key"
      AND NEW."conversion_payload_hash" IS NOT DISTINCT FROM OLD."conversion_payload_hash";

    v_conteudo_igual :=
          NEW."business_unit_id" IS NOT DISTINCT FROM OLD."business_unit_id"
      AND NEW."asset_id" IS NOT DISTINCT FROM OLD."asset_id"
      AND NEW."category" IS NOT DISTINCT FROM OLD."category"
      AND NEW."subject" IS NOT DISTINCT FROM OLD."subject"
      AND NEW."description" IS NOT DISTINCT FROM OLD."description"
      AND NEW."urgency" IS NOT DISTINCT FROM OLD."urgency"
      AND NEW."details" IS NOT DISTINCT FROM OLD."details";

    -- Cancelar: como antes — de OPEN ou IN_TRIAGE, sem mexer no conteúdo.
    v_cancelar := v_identidade_igual AND v_conteudo_igual
      AND OLD."status" IN ('OPEN','IN_TRIAGE')
      AND NEW."status" = 'CANCELLED';

    -- Editar: só antes da triagem, só o conteúdo, sem mudar o status.
    v_editar := v_identidade_igual
      AND OLD."status" = 'OPEN' AND NEW."status" = 'OPEN'
      AND NEW."closed_at" IS NOT DISTINCT FROM OLD."closed_at"
      AND NEW."cancelled_at" IS NOT DISTINCT FROM OLD."cancelled_at";

    -- Responder: chamado vivo, conteúdo intacto; a resposta a "aguardando
    -- cliente" devolve o chamado à equipe.
    v_responder := v_identidade_igual AND v_conteudo_igual
      AND OLD."status" IN ('OPEN','IN_TRIAGE','IN_PROGRESS','WAITING_CUSTOMER')
      AND (
        NEW."status" = OLD."status"
        OR (OLD."status" = 'WAITING_CUSTOMER' AND NEW."status" = 'IN_PROGRESS')
      )
      AND NEW."closed_at" IS NOT DISTINCT FROM OLD."closed_at"
      AND NEW."cancelled_at" IS NOT DISTINCT FROM OLD."cancelled_at";

    IF NOT (v_cancelar OR v_editar OR v_responder) THEN
      RAISE EXCEPTION 'portal may only cancel, edit an open request or reply' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_guard_customer_service_request() FROM PUBLIC;

-- O UPDATE do portal deixa de ser só "cancelar": a forma é do trigger.
DROP POLICY "csr_portal_cancel" ON "customer_service_requests";
CREATE POLICY "csr_portal_update" ON "customer_service_requests" FOR UPDATE
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND "created_by_portal_identity_id" = app_current_portal_identity_id()
  )
  WITH CHECK (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND "created_by_portal_identity_id" = app_current_portal_identity_id()
  );

-- Os eventos que o cliente pode registrar: abrir, cancelar, editar, responder.
DROP POLICY "csr_events_portal_insert" ON "customer_service_request_events";
CREATE POLICY "csr_events_portal_insert" ON "customer_service_request_events" FOR INSERT
  WITH CHECK (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "visibility" = 'PORTAL'
    AND "actor_type" = 'CUSTOMER_PORTAL'
    AND "portal_identity_id" = app_current_portal_identity_id()
    AND "type" IN ('CREATED','CANCELLED','CUSTOMER_UPDATED','CUSTOMER_MESSAGE')
    AND EXISTS (
      SELECT 1 FROM "customer_service_requests" r
      WHERE r."id" = "customer_service_request_events"."request_id"
        AND r."customer_id" = app_current_customer_id()
        AND r."created_by_portal_identity_id" = app_current_portal_identity_id()
    )
  );
