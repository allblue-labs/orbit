-- PR-40 — leasing, retry e dead-letter para a inbox do Stripe.

ALTER TABLE "billing_webhook_events"
  ADD COLUMN "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "processing_token" UUID,
  ADD COLUMN "processing_started_at" TIMESTAMPTZ(3),
  ADD COLUMN "lease_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "dead_lettered_at" TIMESTAMPTZ(3);

ALTER TABLE "billing_webhook_events"
  DROP CONSTRAINT "billing_webhook_events_status_valid";

-- Linhas FAILED da implementação anterior voltam à fila: eram falhas sem
-- política de retry e não podem ser consideradas término definitivo.
UPDATE "billing_webhook_events"
SET "processing_status" = 'PENDING',
    "next_attempt_at" = CURRENT_TIMESTAMP,
    "processed_at" = NULL
WHERE "processing_status" = 'FAILED';

ALTER TABLE "billing_webhook_events"
  ADD CONSTRAINT "billing_webhook_events_status_valid"
  CHECK ("processing_status" IN (
    'PENDING','PROCESSING','PROCESSED','IGNORED','DEAD_LETTER'
  ));

CREATE INDEX "billing_webhook_events_claim_idx"
  ON "billing_webhook_events"
  ("processing_status", "next_attempt_at", "lease_expires_at");
