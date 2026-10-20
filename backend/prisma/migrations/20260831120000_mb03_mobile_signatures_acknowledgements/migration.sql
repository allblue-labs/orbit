-- PR-MB-03 — aceite do cliente é execution-scoped e não altera Customer.
CREATE TABLE "customer_acknowledgements" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "business_unit_id" UUID NOT NULL,
  "execution_type" VARCHAR(30) NOT NULL,
  "execution_id" UUID NOT NULL,
  "customer_id" UUID,
  "contact_id" UUID,
  "signer_name" VARCHAR(180) NOT NULL,
  "signature_storage_file_id" UUID,
  "signature_sha256" CHAR(64),
  "content_version" VARCHAR(80) NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "summary_snapshot" JSONB NOT NULL,
  "command_id" VARCHAR(120) NOT NULL,
  "payload_hash" CHAR(64) NOT NULL,
  "captured_by_user_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(3),
  "acknowledged_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invalidated_at" TIMESTAMPTZ(3),
  "invalidation_reason" VARCHAR(120),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_acknowledgements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_ack_execution_type_check" CHECK ("execution_type" IN ('OPERATION','RVT')),
  CONSTRAINT "customer_ack_signature_pair_check" CHECK (
    ("signature_storage_file_id" IS NULL AND "signature_sha256" IS NULL) OR
    ("signature_storage_file_id" IS NOT NULL AND "signature_sha256" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "customer_ack_command_key"
  ON "customer_acknowledgements"("organization_id", "captured_by_user_id", "command_id");
CREATE UNIQUE INDEX "customer_ack_one_valid_per_execution"
  ON "customer_acknowledgements"("organization_id", "execution_type", "execution_id")
  WHERE "invalidated_at" IS NULL;
CREATE INDEX "customer_ack_execution_idx"
  ON "customer_acknowledgements"("organization_id", "business_unit_id", "execution_type", "execution_id");
CREATE INDEX "customer_ack_customer_idx"
  ON "customer_acknowledgements"("organization_id", "customer_id", "acknowledged_at");
CREATE INDEX "customer_ack_storage_idx"
  ON "customer_acknowledgements"("signature_storage_file_id");

ALTER TABLE "customer_acknowledgements" ADD CONSTRAINT "customer_ack_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_acknowledgements" ADD CONSTRAINT "customer_ack_bu_fkey"
  FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_acknowledgements" ADD CONSTRAINT "customer_ack_customer_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_acknowledgements" ADD CONSTRAINT "customer_ack_contact_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_acknowledgements" ADD CONSTRAINT "customer_ack_storage_fkey"
  FOREIGN KEY ("signature_storage_file_id") REFERENCES "storage_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_acknowledgements" ADD CONSTRAINT "customer_ack_actor_fkey"
  FOREIGN KEY ("captured_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_acknowledgements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_acknowledgements" FORCE ROW LEVEL SECURITY;
CREATE POLICY "customer_acknowledgements_tenant" ON "customer_acknowledgements" FOR ALL
  USING (
    app_is_platform_admin() OR
    (organization_id = app_current_organization_id() AND business_unit_id = ANY(app_current_business_unit_ids()))
  )
  WITH CHECK (
    app_is_platform_admin() OR
    (organization_id = app_current_organization_id() AND business_unit_id = ANY(app_current_business_unit_ids()))
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "customer_acknowledgements" TO orbit_app;
