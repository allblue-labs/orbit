-- PR-44 — a comissão que a organização decidiu não pagar.
--
-- A comissão pendente é derivada e não tem linha para receber status. O
-- cancelamento é a decisão, e decisão é fato: quem, quando e por quê.

CREATE TABLE "commission_cancellations" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "operation_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" VARCHAR(20) NOT NULL,
  "reason" VARCHAR(500),
  "cancelled_by_id" UUID NOT NULL,
  "cancelled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),
  "revoked_by_id" UUID,
  CONSTRAINT "commission_cancellations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_cancellations_organization_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "commission_cancellations_operation_fkey"
    FOREIGN KEY ("operation_id") REFERENCES "operations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_cancellations_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_cancellations_cancelled_by_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_cancellations_revoked_by_fkey"
    FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "commission_cancellations_role_valid"
    CHECK ("role" IN ('PRIMARY','ASSISTANT')),
  -- Desfazer exige quem desfez: uma revogação anônima não se explica depois.
  CONSTRAINT "commission_cancellations_revocation_complete"
    CHECK (
      ("revoked_at" IS NULL AND "revoked_by_id" IS NULL)
      OR ("revoked_at" IS NOT NULL AND "revoked_by_id" IS NOT NULL)
    ),
  CONSTRAINT "commission_cancellations_revocation_after"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "cancelled_at")
);

-- Uma cancelação **em vigor** por comissão. Parcial de propósito: cancelar,
-- desfazer e cancelar de novo é sequência legítima, e cada passo fica registrado.
CREATE UNIQUE INDEX "commission_cancellations_active_unique"
  ON "commission_cancellations" ("organization_id", "operation_id", "user_id", "role")
  WHERE "revoked_at" IS NULL;

CREATE INDEX "commission_cancellations_lookup_idx"
  ON "commission_cancellations" ("organization_id", "operation_id", "user_id", "role");
CREATE INDEX "commission_cancellations_org_user_idx"
  ON "commission_cancellations" ("organization_id", "user_id", "cancelled_at" DESC);

ALTER TABLE "commission_cancellations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "commission_cancellations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "commission_cancellations_tenant_isolation"
  ON "commission_cancellations"
  USING (app_is_platform_admin() OR "organization_id" = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR "organization_id" = app_current_organization_id());

-- UPDATE existe para revogar a própria cancelação. DELETE não: a decisão fica.
GRANT SELECT, INSERT, UPDATE ON TABLE "commission_cancellations" TO orbit_app;
