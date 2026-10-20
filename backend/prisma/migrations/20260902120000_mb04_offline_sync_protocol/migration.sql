CREATE TABLE "mobile_offline_command_receipts" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID NOT NULL,
  "actor_id" UUID NOT NULL,
  "command_id" VARCHAR(120) NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "command_type" VARCHAR(60) NOT NULL,
  "aggregate_type" VARCHAR(40) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "device_instance_id" VARCHAR(120),
  "payload_hash" CHAR(64) NOT NULL,
  "result_status" VARCHAR(30) NOT NULL,
  "result" JSONB NOT NULL DEFAULT '{}',
  "server_version" VARCHAR(80),
  "occurred_at" TIMESTAMPTZ(3) NOT NULL,
  "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "mobile_offline_command_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mobile_offline_receipts_status_check" CHECK ("result_status" IN ('APPLIED','ALREADY_APPLIED')),
  CONSTRAINT "mobile_offline_receipts_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "mobile_offline_receipts_bu_fk" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE CASCADE,
  CONSTRAINT "mobile_offline_receipts_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "mobile_offline_receipts_org_command_key" ON "mobile_offline_command_receipts"("organization_id", "command_id");
CREATE UNIQUE INDEX "mobile_offline_receipts_org_actor_idem_key" ON "mobile_offline_command_receipts"("organization_id", "actor_id", "idempotency_key");
CREATE INDEX "mobile_offline_receipts_org_bu_processed_idx" ON "mobile_offline_command_receipts"("organization_id", "business_unit_id", "processed_at");
CREATE INDEX "mobile_offline_receipts_expires_idx" ON "mobile_offline_command_receipts"("expires_at");

CREATE TABLE "mobile_sync_changes" (
  "sequence" BIGSERIAL NOT NULL,
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID NOT NULL,
  "resource_type" VARCHAR(40) NOT NULL,
  "resource_id" VARCHAR(180) NOT NULL,
  "change_type" VARCHAR(30) NOT NULL,
  "resource_version" VARCHAR(80),
  "actor_id" UUID,
  "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "mobile_sync_changes_pkey" PRIMARY KEY ("sequence"),
  CONSTRAINT "mobile_sync_changes_type_check" CHECK ("change_type" IN ('UPSERTED','REMOVED','REVOKED','OUT_OF_SCOPE')),
  CONSTRAINT "mobile_sync_changes_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "mobile_sync_changes_bu_fk" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE CASCADE,
  CONSTRAINT "mobile_sync_changes_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "mobile_sync_changes_org_bu_seq_idx" ON "mobile_sync_changes"("organization_id", "business_unit_id", "sequence");
CREATE INDEX "mobile_sync_changes_resource_seq_idx" ON "mobile_sync_changes"("organization_id", "resource_type", "resource_id", "sequence");
CREATE INDEX "mobile_sync_changes_expires_idx" ON "mobile_sync_changes"("expires_at");

ALTER TABLE "mobile_offline_command_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_offline_command_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mobile_offline_receipts_tenant_scope" ON "mobile_offline_command_receipts"
  USING (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
    AND "actor_id" = app_current_user_id()
  )
  WITH CHECK (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
    AND "actor_id" = app_current_user_id()
  );

ALTER TABLE "mobile_sync_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mobile_sync_changes" FORCE ROW LEVEL SECURITY;
CREATE POLICY "mobile_sync_changes_tenant_scope" ON "mobile_sync_changes"
  USING (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
  )
  WITH CHECK (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
  );

GRANT SELECT, INSERT, UPDATE ON "mobile_offline_command_receipts" TO orbit_app;
GRANT SELECT, INSERT ON "mobile_sync_changes" TO orbit_app;
GRANT USAGE, SELECT ON SEQUENCE "mobile_sync_changes_sequence_seq" TO orbit_app;

COMMENT ON TABLE "mobile_offline_command_receipts" IS 'MB-04 durable idempotency receipts; command plaintext is intentionally not stored';
COMMENT ON TABLE "mobile_sync_changes" IS 'MB-04 tenant-scoped metadata journal for opaque-cursor incremental pull';
