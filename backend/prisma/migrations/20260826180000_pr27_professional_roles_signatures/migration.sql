-- PR-27 — papéis profissionais, assinatura gráfica cadastrada e snapshot do signatário.
-- FIELD_TECHNICIAN e TECHNICAL_RESPONSIBLE são independentes de RBAC.

CREATE TABLE "professional_profiles" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "field_technician_enabled" BOOLEAN NOT NULL DEFAULT false,
  "technical_responsible_enabled" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "professional_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "professional_credentials" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "professional_profile_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "type" VARCHAR(20) NOT NULL,
  "registration_number" VARCHAR(100) NOT NULL,
  "region" VARCHAR(40),
  "issuing_authority" VARCHAR(120),
  "display_label" VARCHAR(180),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "professional_credentials_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "professional_credentials_type_check" CHECK ("type" IN ('CREA','CFT','CRT','OTHER'))
);

CREATE TABLE "user_signatures" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "storage_object_id" UUID NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  CONSTRAINT "user_signatures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "professional_profiles_organization_id_user_id_key" ON "professional_profiles"("organization_id", "user_id");
CREATE INDEX "professional_profiles_field_idx" ON "professional_profiles"("organization_id", "active", "field_technician_enabled");
CREATE INDEX "professional_profiles_responsible_idx" ON "professional_profiles"("organization_id", "active", "technical_responsible_enabled");
CREATE UNIQUE INDEX "professional_credentials_profile_type_number_key" ON "professional_credentials"("professional_profile_id", "type", "registration_number");
CREATE INDEX "professional_credentials_org_user_active_idx" ON "professional_credentials"("organization_id", "user_id", "active");
CREATE UNIQUE INDEX "user_signatures_org_user_version_key" ON "user_signatures"("organization_id", "user_id", "version");
CREATE UNIQUE INDEX "user_signatures_one_active_per_user" ON "user_signatures"("organization_id", "user_id") WHERE "active" = true;
CREATE INDEX "user_signatures_org_user_active_idx" ON "user_signatures"("organization_id", "user_id", "active");

ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "professional_credentials" ADD CONSTRAINT "professional_credentials_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "professional_credentials" ADD CONSTRAINT "professional_credentials_professional_profile_id_fkey" FOREIGN KEY ("professional_profile_id") REFERENCES "professional_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "professional_credentials" ADD CONSTRAINT "professional_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_signatures" ADD CONSTRAINT "user_signatures_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Snapshot estende o mecanismo imutável já existente; nenhum sistema paralelo.
ALTER TABLE "artifact_execution_signatures"
  ADD COLUMN "signed_as" VARCHAR(40),
  ADD COLUMN "signature_asset_id" UUID,
  ADD COLUMN "signature_asset_hash" CHAR(64),
  ADD COLUMN "professional_role" VARCHAR(40),
  ADD COLUMN "credential_type" VARCHAR(20),
  ADD COLUMN "credential_number" VARCHAR(100),
  ADD COLUMN "credential_region" VARCHAR(40),
  ADD COLUMN "captured_at" TIMESTAMPTZ(3);

ALTER TABLE "artifact_execution_signatures"
  ADD CONSTRAINT "artifact_execution_signatures_signed_as_check"
  CHECK ("signed_as" IS NULL OR "signed_as" IN ('FIELD_TECHNICIAN','TECHNICAL_RESPONSIBLE','CUSTOMER'));

-- Backfill conservador: uma atribuição real em Operation é evidência de atuação
-- em campo. PMOC, assinatura ou credential não concedem responsabilidade técnica.
INSERT INTO "professional_profiles" (
  "id", "organization_id", "user_id", "field_technician_enabled",
  "technical_responsible_enabled", "active", "created_at", "updated_at"
)
SELECT (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  o.organization_id, ou.user_id, true, false, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM operation_users ou
  JOIN operations o ON o.id = ou.operation_id
  JOIN organization_memberships om
    ON om.organization_id = o.organization_id AND om.user_id = ou.user_id
 WHERE o.deleted_at IS NULL AND om.status = 'ACTIVE' AND om.deleted_at IS NULL
 GROUP BY o.organization_id, ou.user_id
ON CONFLICT (organization_id, user_id) DO UPDATE
  SET field_technician_enabled = true, updated_at = CURRENT_TIMESTAMP;

ALTER TABLE "professional_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "professional_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY "professional_profiles_tenant" ON "professional_profiles" FOR ALL
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());

ALTER TABLE "professional_credentials" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "professional_credentials" FORCE ROW LEVEL SECURITY;
CREATE POLICY "professional_credentials_tenant" ON "professional_credentials" FOR ALL
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());

ALTER TABLE "user_signatures" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_signatures" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_signatures_tenant" ON "user_signatures" FOR ALL
  USING (app_is_platform_admin() OR organization_id = app_current_organization_id())
  WITH CHECK (app_is_platform_admin() OR organization_id = app_current_organization_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "professional_profiles" TO orbit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "professional_credentials" TO orbit_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "user_signatures" TO orbit_app;
