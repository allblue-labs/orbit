CREATE TABLE "field_artifacts" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID NOT NULL,
  "source_type" VARCHAR(40) NOT NULL,
  "source_id" UUID NOT NULL,
  "document_type" VARCHAR(40) NOT NULL,
  "snapshot_version" INTEGER NOT NULL DEFAULT 1,
  "snapshot" JSONB NOT NULL,
  "snapshot_hash" CHAR(64) NOT NULL,
  "artifact_execution_id" UUID NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "field_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "field_artifacts_source_type_check" CHECK ("source_type" IN ('OPERATION','RVT_EXECUTION','PMOC_EQUIPMENT_EXECUTION')),
  CONSTRAINT "field_artifacts_document_type_check" CHECK ("document_type" IN ('SERVICE_ORDER','RVT','PMOC')),
  CONSTRAINT "field_artifacts_snapshot_version_check" CHECK ("snapshot_version" > 0),
  CONSTRAINT "field_artifacts_snapshot_hash_check" CHECK ("snapshot_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "field_artifacts_org_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "field_artifacts_bu_fk" FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE RESTRICT,
  CONSTRAINT "field_artifacts_execution_fk" FOREIGN KEY ("artifact_execution_id") REFERENCES "artifact_executions"("id") ON DELETE RESTRICT,
  CONSTRAINT "field_artifacts_actor_fk" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "field_artifacts_execution_key" ON "field_artifacts"("artifact_execution_id");
CREATE UNIQUE INDEX "field_artifacts_source_version_key"
  ON "field_artifacts"("organization_id", "source_type", "source_id", "document_type", "snapshot_version");
CREATE INDEX "field_artifacts_org_bu_created_idx"
  ON "field_artifacts"("organization_id", "business_unit_id", "created_at");
CREATE INDEX "field_artifacts_source_idx"
  ON "field_artifacts"("organization_id", "source_type", "source_id");

ALTER TABLE "field_artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "field_artifacts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "field_artifacts_tenant_unit_scope" ON "field_artifacts"
  USING (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
  )
  WITH CHECK (
    "organization_id" = app_current_organization_id()
    AND "business_unit_id" = ANY(app_current_business_unit_ids())
    AND "created_by_id" = app_current_user_id()
  );

GRANT SELECT, INSERT ON TABLE "field_artifacts" TO orbit_app;
