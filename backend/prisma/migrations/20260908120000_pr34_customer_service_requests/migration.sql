-- ORBIT V2 PR-34 — Customer Service Requests / Chamados.
-- A Portal request is its own aggregate. It only becomes an Operation through
-- the explicit, atomic internal conversion command.

CREATE TABLE "customer_service_requests" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "customer_id" UUID NOT NULL,
  "created_by_portal_identity_id" UUID NOT NULL,
  "business_unit_id" UUID,
  "asset_id" UUID,
  "code" VARCHAR(60) NOT NULL,
  "category" VARCHAR(40) NOT NULL,
  "subject" VARCHAR(180) NOT NULL,
  "description" TEXT NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  "assigned_to_user_id" UUID,
  "converted_operation_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "create_idempotency_key" VARCHAR(160) NOT NULL,
  "create_payload_hash" CHAR(64) NOT NULL,
  "conversion_idempotency_key" VARCHAR(160),
  "conversion_payload_hash" CHAR(64),
  "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_service_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "csr_category_check" CHECK ("category" IN (
    'MAINTENANCE','EQUIPMENT_PROBLEM','SERVICE_REQUEST',
    'DOCUMENT_REQUEST','QUESTION','OTHER'
  )),
  CONSTRAINT "csr_status_check" CHECK ("status" IN (
    'OPEN','IN_TRIAGE','IN_PROGRESS','WAITING_CUSTOMER',
    'RESOLVED','REJECTED','CANCELLED'
  )),
  CONSTRAINT "csr_version_check" CHECK ("version" > 0),
  CONSTRAINT "csr_conversion_idempotency_pair_check" CHECK (
    ("conversion_idempotency_key" IS NULL) = ("conversion_payload_hash" IS NULL)
  ),
  CONSTRAINT "csr_closed_state_check" CHECK (
    ("status" IN ('RESOLVED','REJECTED','CANCELLED')) = ("closed_at" IS NOT NULL)
  ),
  CONSTRAINT "csr_cancelled_state_check" CHECK (
    ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
  )
);

CREATE TABLE "customer_service_request_events" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "visibility" VARCHAR(20) NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "actor_type" VARCHAR(30) NOT NULL,
  "portal_identity_id" UUID,
  "internal_user_id" UUID,
  "actor_display_name" VARCHAR(180) NOT NULL,
  "message" TEXT,
  "from_status" VARCHAR(30),
  "to_status" VARCHAR(30),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "customer_service_request_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "csr_event_visibility_check" CHECK ("visibility" IN ('PORTAL','INTERNAL')),
  CONSTRAINT "csr_event_actor_check" CHECK (
    ("actor_type" = 'CUSTOMER_PORTAL' AND "portal_identity_id" IS NOT NULL AND "internal_user_id" IS NULL)
    OR ("actor_type" = 'INTERNAL_USER' AND "portal_identity_id" IS NULL AND "internal_user_id" IS NOT NULL)
    OR ("actor_type" = 'SYSTEM' AND "portal_identity_id" IS NULL AND "internal_user_id" IS NULL)
  )
);

CREATE UNIQUE INDEX "csr_org_code_key"
  ON "customer_service_requests"("organization_id", "code");
CREATE UNIQUE INDEX "csr_portal_create_idempotency_key"
  ON "customer_service_requests"("created_by_portal_identity_id", "create_idempotency_key");
CREATE UNIQUE INDEX "csr_converted_operation_key"
  ON "customer_service_requests"("converted_operation_id")
  WHERE "converted_operation_id" IS NOT NULL;
CREATE INDEX "csr_customer_status_created_idx"
  ON "customer_service_requests"("organization_id", "customer_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "csr_bu_status_created_idx"
  ON "customer_service_requests"("organization_id", "business_unit_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "csr_assignee_status_created_idx"
  ON "customer_service_requests"("organization_id", "assigned_to_user_id", "status", "created_at" DESC, "id" DESC);
CREATE INDEX "csr_events_request_timeline_idx"
  ON "customer_service_request_events"("request_id", "created_at", "id");
CREATE INDEX "csr_events_org_visibility_idx"
  ON "customer_service_request_events"("organization_id", "visibility", "created_at" DESC);

ALTER TABLE "customer_service_requests" ADD CONSTRAINT "csr_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_service_requests" ADD CONSTRAINT "csr_customer_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_service_requests" ADD CONSTRAINT "csr_portal_identity_fkey"
  FOREIGN KEY ("created_by_portal_identity_id") REFERENCES "customer_portal_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_service_requests" ADD CONSTRAINT "csr_bu_fkey"
  FOREIGN KEY ("business_unit_id") REFERENCES "business_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_service_requests" ADD CONSTRAINT "csr_asset_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_service_requests" ADD CONSTRAINT "csr_assignee_fkey"
  FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_service_requests" ADD CONSTRAINT "csr_operation_fkey"
  FOREIGN KEY ("converted_operation_id") REFERENCES "operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_service_request_events" ADD CONSTRAINT "csr_event_org_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_service_request_events" ADD CONSTRAINT "csr_event_request_fkey"
  FOREIGN KEY ("request_id") REFERENCES "customer_service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "customer_service_request_events" ADD CONSTRAINT "csr_event_portal_actor_fkey"
  FOREIGN KEY ("portal_identity_id") REFERENCES "customer_portal_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customer_service_request_events" ADD CONSTRAINT "csr_event_internal_actor_fkey"
  FOREIGN KEY ("internal_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Defense in depth: ownership is canonical even if a repository is called with
-- forged identifiers. Portal UPDATE is deliberately limited to cancellation.
CREATE OR REPLACE FUNCTION app_guard_customer_service_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
    IF OLD."status" NOT IN ('OPEN','IN_TRIAGE')
       OR OLD."converted_operation_id" IS NOT NULL
       OR NEW."status" <> 'CANCELLED'
       OR NEW."version" <> OLD."version" + 1
       OR NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
       OR NEW."customer_id" IS DISTINCT FROM OLD."customer_id"
       OR NEW."created_by_portal_identity_id" IS DISTINCT FROM OLD."created_by_portal_identity_id"
       OR NEW."business_unit_id" IS DISTINCT FROM OLD."business_unit_id"
       OR NEW."asset_id" IS DISTINCT FROM OLD."asset_id"
       OR NEW."code" IS DISTINCT FROM OLD."code"
       OR NEW."category" IS DISTINCT FROM OLD."category"
       OR NEW."subject" IS DISTINCT FROM OLD."subject"
       OR NEW."description" IS DISTINCT FROM OLD."description"
       OR NEW."assigned_to_user_id" IS DISTINCT FROM OLD."assigned_to_user_id"
       OR NEW."converted_operation_id" IS DISTINCT FROM OLD."converted_operation_id"
       OR NEW."create_idempotency_key" IS DISTINCT FROM OLD."create_idempotency_key"
       OR NEW."create_payload_hash" IS DISTINCT FROM OLD."create_payload_hash"
       OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
       OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
       OR NEW."conversion_idempotency_key" IS DISTINCT FROM OLD."conversion_idempotency_key"
       OR NEW."conversion_payload_hash" IS DISTINCT FROM OLD."conversion_payload_hash" THEN
      RAISE EXCEPTION 'portal may only cancel an eligible service request' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "csr_scope_and_portal_update_guard"
BEFORE INSERT OR UPDATE ON "customer_service_requests"
FOR EACH ROW EXECUTE FUNCTION app_guard_customer_service_request();

CREATE OR REPLACE FUNCTION app_guard_customer_service_request_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "customer_service_requests" r
    WHERE r."id" = NEW."request_id" AND r."organization_id" = NEW."organization_id"
  ) THEN
    RAISE EXCEPTION 'customer service request event scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "csr_event_scope_guard"
BEFORE INSERT ON "customer_service_request_events"
FOR EACH ROW EXECUTE FUNCTION app_guard_customer_service_request_event();

ALTER TABLE "customer_service_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_service_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "customer_service_request_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_service_request_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "csr_portal_select" ON "customer_service_requests" FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND "created_by_portal_identity_id" = app_current_portal_identity_id()
  );
CREATE POLICY "csr_portal_insert" ON "customer_service_requests" FOR INSERT
  WITH CHECK (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND "created_by_portal_identity_id" = app_current_portal_identity_id()
    AND "status" = 'OPEN'
    AND "assigned_to_user_id" IS NULL
    AND "converted_operation_id" IS NULL
  );
CREATE POLICY "csr_portal_cancel" ON "customer_service_requests" FOR UPDATE
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
    AND "status" = 'CANCELLED'
  );

CREATE POLICY "csr_internal_select" ON "customer_service_requests" FOR SELECT
  USING (
    app_is_platform_admin() OR (
      app_current_actor_type() = 'INTERNAL_USER'
      AND "organization_id" = app_current_organization_id()
      AND ("business_unit_id" IS NULL OR "business_unit_id" = ANY(app_current_business_unit_ids()))
      AND (app_has_permission('customer_service_requests.read') OR app_has_permission('customer_service_requests.manage') OR app_has_permission('*'))
    )
  );
CREATE POLICY "csr_internal_update" ON "customer_service_requests" FOR UPDATE
  USING (
    app_is_platform_admin() OR (
      app_current_actor_type() = 'INTERNAL_USER'
      AND "organization_id" = app_current_organization_id()
      AND ("business_unit_id" IS NULL OR "business_unit_id" = ANY(app_current_business_unit_ids()))
      AND (app_has_permission('customer_service_requests.manage') OR app_has_permission('*'))
    )
  )
  WITH CHECK (
    app_is_platform_admin() OR (
      app_current_actor_type() = 'INTERNAL_USER'
      AND "organization_id" = app_current_organization_id()
      AND ("business_unit_id" IS NULL OR "business_unit_id" = ANY(app_current_business_unit_ids()))
      AND (app_has_permission('customer_service_requests.manage') OR app_has_permission('*'))
    )
  );

CREATE POLICY "csr_events_portal_select" ON "customer_service_request_events" FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "visibility" = 'PORTAL'
    AND EXISTS (
      SELECT 1 FROM "customer_service_requests" r
      WHERE r."id" = "customer_service_request_events"."request_id"
        AND r."customer_id" = app_current_customer_id()
        AND r."created_by_portal_identity_id" = app_current_portal_identity_id()
    )
  );
CREATE POLICY "csr_events_portal_insert" ON "customer_service_request_events" FOR INSERT
  WITH CHECK (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "visibility" = 'PORTAL'
    AND "actor_type" = 'CUSTOMER_PORTAL'
    AND "portal_identity_id" = app_current_portal_identity_id()
    AND "type" IN ('CREATED','CANCELLED')
    AND EXISTS (
      SELECT 1 FROM "customer_service_requests" r
      WHERE r."id" = "customer_service_request_events"."request_id"
        AND r."customer_id" = app_current_customer_id()
        AND r."created_by_portal_identity_id" = app_current_portal_identity_id()
    )
  );
CREATE POLICY "csr_events_internal_select" ON "customer_service_request_events" FOR SELECT
  USING (
    app_is_platform_admin() OR (
      app_current_actor_type() = 'INTERNAL_USER'
      AND "organization_id" = app_current_organization_id()
      AND (app_has_permission('customer_service_requests.read') OR app_has_permission('customer_service_requests.manage') OR app_has_permission('*'))
      AND EXISTS (SELECT 1 FROM "customer_service_requests" r WHERE r."id" = "customer_service_request_events"."request_id")
    )
  );
CREATE POLICY "csr_events_internal_insert" ON "customer_service_request_events" FOR INSERT
  WITH CHECK (
    app_is_platform_admin() OR (
      app_current_actor_type() = 'INTERNAL_USER'
      AND "organization_id" = app_current_organization_id()
      AND (app_has_permission('customer_service_requests.manage') OR app_has_permission('*'))
      AND "actor_type" IN ('INTERNAL_USER','SYSTEM')
      AND EXISTS (SELECT 1 FROM "customer_service_requests" r WHERE r."id" = "customer_service_request_events"."request_id")
    )
  );

GRANT SELECT, INSERT, UPDATE ON TABLE "customer_service_requests" TO orbit_app;
GRANT SELECT, INSERT ON TABLE "customer_service_request_events" TO orbit_app;

UPDATE "plans"
SET "capabilities" = ARRAY(
  SELECT DISTINCT capability
  FROM unnest("capabilities" || ARRAY[
    'customer_service_requests.read',
    'customer_service_requests.manage'
  ]::VARCHAR[]) AS capability
), "updated_at" = CURRENT_TIMESTAMP
WHERE "is_active" = TRUE;
