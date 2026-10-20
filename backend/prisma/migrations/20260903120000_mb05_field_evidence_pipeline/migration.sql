CREATE TABLE "field_evidence_uploads" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID NOT NULL,
  "operation_id" UUID,
  "pmoc_equipment_execution_id" UUID,
  "rvt_execution_id" UUID,
  "storage_file_id" UUID NOT NULL,
  "captured_by_user_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(160) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "local_media_id" VARCHAR(160),
  "category" VARCHAR(30) NOT NULL DEFAULT 'GENERAL',
  "source" VARCHAR(20) NOT NULL DEFAULT 'CAMERA',
  "captured_at" TIMESTAMPTZ(3),
  "expected_sha256" CHAR(64),
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING_UPLOAD',
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "uploaded_at" TIMESTAMPTZ(3),
  "finalized_at" TIMESTAMPTZ(3),
  "failure_code" VARCHAR(80),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "field_evidence_uploads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "field_evidence_upload_target_check" CHECK (num_nonnulls("operation_id", "pmoc_equipment_execution_id", "rvt_execution_id") = 1),
  CONSTRAINT "field_evidence_upload_status_check" CHECK ("status" IN ('PENDING_UPLOAD','UPLOADED','FINALIZED','FAILED','EXPIRED')),
  CONSTRAINT "field_evidence_upload_category_check" CHECK ("category" IN ('BEFORE','AFTER','GENERAL','EQUIPMENT','DEFECT','MEASUREMENT')),
  CONSTRAINT "field_evidence_upload_source_check" CHECK ("source" IN ('CAMERA','GALLERY','FILE')),
  CONSTRAINT "field_evidence_upload_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "field_evidence_upload_bu_fk" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE CASCADE,
  CONSTRAINT "field_evidence_upload_operation_fk" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE CASCADE,
  CONSTRAINT "field_evidence_upload_pmoc_fk" FOREIGN KEY ("pmoc_equipment_execution_id") REFERENCES "pmoc_equipment_executions"("id") ON DELETE CASCADE,
  CONSTRAINT "field_evidence_upload_rvt_fk" FOREIGN KEY ("rvt_execution_id") REFERENCES "rvt_executions"("id") ON DELETE CASCADE,
  CONSTRAINT "field_evidence_upload_storage_fk" FOREIGN KEY ("storage_file_id") REFERENCES "storage_files"("id") ON DELETE RESTRICT,
  CONSTRAINT "field_evidence_upload_actor_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "field_evidence_upload_storage_key" ON "field_evidence_uploads"("storage_file_id");
CREATE UNIQUE INDEX "field_evidence_upload_actor_idem_key" ON "field_evidence_uploads"("organization_id", "captured_by_user_id", "idempotency_key");
CREATE UNIQUE INDEX "field_evidence_upload_local_media_key" ON "field_evidence_uploads"("organization_id", "captured_by_user_id", "local_media_id") WHERE "local_media_id" IS NOT NULL;
CREATE INDEX "field_evidence_upload_expiry_idx" ON "field_evidence_uploads"("organization_id", "business_unit_id", "status", "expires_at");
CREATE INDEX "field_evidence_upload_operation_idx" ON "field_evidence_uploads"("operation_id", "status");
CREATE INDEX "field_evidence_upload_pmoc_idx" ON "field_evidence_uploads"("pmoc_equipment_execution_id", "status");
CREATE INDEX "field_evidence_upload_rvt_idx" ON "field_evidence_uploads"("rvt_execution_id", "status");

CREATE TABLE "field_evidence" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID NOT NULL,
  "upload_id" UUID NOT NULL,
  "operation_id" UUID,
  "pmoc_equipment_execution_id" UUID,
  "rvt_execution_id" UUID,
  "storage_file_id" UUID NOT NULL,
  "category" VARCHAR(30) NOT NULL,
  "source" VARCHAR(20) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "mime_type" VARCHAR(160) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "captured_at" TIMESTAMPTZ(3),
  "uploaded_at" TIMESTAMPTZ(3) NOT NULL,
  "captured_by_user_id" UUID NOT NULL,
  "local_media_id" VARCHAR(160),
  "status" VARCHAR(20) NOT NULL DEFAULT 'FINALIZED',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "field_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "field_evidence_target_check" CHECK (num_nonnulls("operation_id", "pmoc_equipment_execution_id", "rvt_execution_id") = 1),
  CONSTRAINT "field_evidence_status_check" CHECK ("status" = 'FINALIZED'),
  CONSTRAINT "field_evidence_size_check" CHECK ("size_bytes" >= 0),
  CONSTRAINT "field_evidence_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "field_evidence_bu_fk" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE RESTRICT,
  CONSTRAINT "field_evidence_upload_fk" FOREIGN KEY ("upload_id") REFERENCES "field_evidence_uploads"("id") ON DELETE RESTRICT,
  CONSTRAINT "field_evidence_operation_fk" FOREIGN KEY ("operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT,
  CONSTRAINT "field_evidence_pmoc_fk" FOREIGN KEY ("pmoc_equipment_execution_id") REFERENCES "pmoc_equipment_executions"("id") ON DELETE RESTRICT,
  CONSTRAINT "field_evidence_rvt_fk" FOREIGN KEY ("rvt_execution_id") REFERENCES "rvt_executions"("id") ON DELETE RESTRICT,
  CONSTRAINT "field_evidence_storage_fk" FOREIGN KEY ("storage_file_id") REFERENCES "storage_files"("id") ON DELETE RESTRICT,
  CONSTRAINT "field_evidence_actor_fk" FOREIGN KEY ("captured_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "field_evidence_upload_key" ON "field_evidence"("upload_id");
CREATE UNIQUE INDEX "field_evidence_storage_key" ON "field_evidence"("storage_file_id");
CREATE INDEX "field_evidence_org_bu_created_idx" ON "field_evidence"("organization_id", "business_unit_id", "created_at");
CREATE INDEX "field_evidence_operation_created_idx" ON "field_evidence"("operation_id", "created_at");
CREATE INDEX "field_evidence_pmoc_created_idx" ON "field_evidence"("pmoc_equipment_execution_id", "created_at");
CREATE INDEX "field_evidence_rvt_created_idx" ON "field_evidence"("rvt_execution_id", "created_at");

ALTER TABLE "field_evidence_uploads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "field_evidence_uploads" FORCE ROW LEVEL SECURITY;
CREATE POLICY "field_evidence_upload_actor_scope" ON "field_evidence_uploads"
  USING (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
    AND "captured_by_user_id" = app_current_user_id()
  )
  WITH CHECK (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
    AND "captured_by_user_id" = app_current_user_id()
  );

ALTER TABLE "field_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "field_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "field_evidence_tenant_scope" ON "field_evidence"
  USING (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
  )
  WITH CHECK (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
    AND "captured_by_user_id" = app_current_user_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON "field_evidence_uploads" TO orbit_app;
GRANT SELECT, INSERT ON "field_evidence" TO orbit_app;

COMMENT ON TABLE "field_evidence_uploads" IS 'MB-05 temporary direct-upload intents; authorization is revalidated on finalize';
COMMENT ON TABLE "field_evidence" IS 'MB-05 immutable canonical field evidence for Operation, PMOC equipment execution and RVT execution';
