-- ORBIT V2 PR-33 — read-only Customer Portal access to canonical resources.
--
-- Portal scope is always transaction-local and comes from the authenticated
-- Portal Identity. These policies grant SELECT only and never use a BU sent by
-- the client. Existing internal/system behavior remains unchanged.

-- Policies that previously treated every actor with an organization context as
-- an internal user are split so a Portal actor cannot mutate or enumerate
-- organization/customer/contact rows through an accidental repository call.
DROP POLICY "organizations_tenant_isolation" ON "organizations";
CREATE POLICY "organizations_internal_tenant_isolation" ON "organizations"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "id" = app_current_organization_id()
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "id" = app_current_organization_id()
    )
  );
CREATE POLICY "organizations_portal_self_read" ON "organizations"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "id" = app_current_organization_id()
    AND app_current_portal_identity_id() IS NOT NULL
  );

DROP POLICY "customers_tenant_isolation" ON "customers";
CREATE POLICY "customers_internal_tenant_isolation" ON "customers"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
    )
  );
CREATE POLICY "customers_portal_self_read" ON "customers"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "id" = app_current_customer_id()
    AND app_current_portal_identity_id() IS NOT NULL
  );

DROP POLICY "contacts_optional_unit_isolation" ON "contacts";
CREATE POLICY "contacts_internal_optional_unit_isolation" ON "contacts"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
      AND (
        "business_unit_id" IS NULL
        OR "business_unit_id" = ANY(app_current_business_unit_ids())
      )
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
      AND (
        "business_unit_id" IS NULL
        OR "business_unit_id" = ANY(app_current_business_unit_ids())
      )
    )
  );
CREATE POLICY "contacts_portal_customer_read" ON "contacts"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND app_current_portal_identity_id() IS NOT NULL
  );

CREATE POLICY "operations_portal_customer_read" ON "operations"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND "deleted_at" IS NULL
    AND app_current_portal_identity_id() IS NOT NULL
  );

CREATE POLICY "assets_portal_customer_read" ON "assets"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND "deleted_at" IS NULL
    AND app_current_portal_identity_id() IS NOT NULL
  );

CREATE POLICY "business_units_portal_related_read" ON "business_units"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND app_current_portal_identity_id() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM "operations" o
        WHERE o."business_unit_id" = "business_units"."id"
          AND o."customer_id" = app_current_customer_id()
          AND o."deleted_at" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM "assets" a
        WHERE a."business_unit_id" = "business_units"."id"
          AND a."customer_id" = app_current_customer_id()
          AND a."deleted_at" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM "pmoc_plans" p
        WHERE p."business_unit_id" = "business_units"."id"
          AND p."customer_id" = app_current_customer_id()
          AND p."deleted_at" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM "rvt_configurations" r
        WHERE r."business_unit_id" = "business_units"."id"
          AND r."customer_id" = app_current_customer_id()
          AND r."deleted_at" IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM "artifact_executions" e
        WHERE e."business_unit_id" = "business_units"."id"
          AND e."customer_id" = app_current_customer_id()
          AND e."deleted_at" IS NULL
      )
    )
  );

CREATE POLICY "pmoc_plans_portal_customer_read" ON "pmoc_plans"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND "deleted_at" IS NULL
    AND app_current_portal_identity_id() IS NOT NULL
  );

-- The original child policies are organization-wide for internal actors. They
-- are narrowed for Portal and complemented with customer-derived SELECT.
DROP POLICY "pmoc_coverages_tenant" ON "pmoc_equipment_coverages";
CREATE POLICY "pmoc_coverages_internal_tenant" ON "pmoc_equipment_coverages"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
    )
  );
CREATE POLICY "pmoc_coverages_portal_customer_read" ON "pmoc_equipment_coverages"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "deleted_at" IS NULL
    AND EXISTS (
      SELECT 1 FROM "pmoc_plans" p
      WHERE p."id" = "pmoc_equipment_coverages"."plan_id"
        AND p."customer_id" = app_current_customer_id()
        AND p."deleted_at" IS NULL
    )
  );

DROP POLICY "pmoc_executions_tenant" ON "pmoc_executions";
CREATE POLICY "pmoc_executions_internal_tenant" ON "pmoc_executions"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
    )
  );
CREATE POLICY "pmoc_executions_portal_customer_read" ON "pmoc_executions"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND EXISTS (
      SELECT 1 FROM "pmoc_plans" p
      WHERE p."id" = "pmoc_executions"."plan_id"
        AND p."customer_id" = app_current_customer_id()
        AND p."deleted_at" IS NULL
    )
  );

CREATE POLICY "rvt_configurations_portal_customer_read" ON "rvt_configurations"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND "deleted_at" IS NULL
    AND app_current_portal_identity_id() IS NOT NULL
  );
CREATE POLICY "rvt_occurrences_portal_customer_read" ON "rvt_occurrences"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND EXISTS (
      SELECT 1 FROM "rvt_configurations" c
      WHERE c."id" = "rvt_occurrences"."configuration_id"
        AND c."customer_id" = app_current_customer_id()
        AND c."deleted_at" IS NULL
    )
  );
CREATE POLICY "rvt_executions_portal_customer_read" ON "rvt_executions"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND EXISTS (
      SELECT 1
      FROM "rvt_occurrences" o
      JOIN "rvt_configurations" c ON c."id" = o."configuration_id"
      WHERE o."id" = "rvt_executions"."occurrence_id"
        AND c."customer_id" = app_current_customer_id()
        AND c."deleted_at" IS NULL
    )
  );
CREATE POLICY "rvt_configuration_equipment_portal_customer_read"
  ON "rvt_configuration_equipment"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "removed_at" IS NULL
    AND EXISTS (
      SELECT 1 FROM "rvt_configurations" c
      WHERE c."id" = "rvt_configuration_equipment"."configuration_id"
        AND c."customer_id" = app_current_customer_id()
        AND c."deleted_at" IS NULL
    )
  );

CREATE POLICY "artifact_executions_portal_customer_read" ON "artifact_executions"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "customer_id" = app_current_customer_id()
    AND "deleted_at" IS NULL
    AND app_current_portal_identity_id() IS NOT NULL
  );
CREATE POLICY "artifact_manifests_portal_customer_read" ON "artifact_manifests"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "status" = 'ISSUED'
    AND "is_active"
    AND "revoked_at" IS NULL
    AND "deleted_at" IS NULL
    AND EXISTS (
      SELECT 1 FROM "artifact_executions" e
      WHERE e."id" = "artifact_manifests"."execution_id"
        AND e."customer_id" = app_current_customer_id()
        AND e."status" IN ('APPROVED', 'COMPLETED', 'ARCHIVED')
        AND e."deleted_at" IS NULL
    )
  );

DROP POLICY "storage_files_tenant" ON "storage_files";
CREATE POLICY "storage_files_internal_tenant" ON "storage_files"
  FOR ALL
  USING (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
    )
  )
  WITH CHECK (
    app_is_platform_admin()
    OR (
      app_current_actor_type() <> 'CUSTOMER_PORTAL'
      AND "organization_id" = app_current_organization_id()
    )
  );
CREATE POLICY "storage_files_portal_document_read" ON "storage_files"
  FOR SELECT
  USING (
    app_current_actor_type() = 'CUSTOMER_PORTAL'
    AND "organization_id" = app_current_organization_id()
    AND "status" = 'AVAILABLE'
    AND "deleted_at" IS NULL
    AND EXISTS (
      SELECT 1
      FROM "artifact_manifests" m
      JOIN "artifact_executions" e ON e."id" = m."execution_id"
      WHERE m."file_id" = "storage_files"."id"
        AND m."status" = 'ISSUED'
        AND m."is_active"
        AND m."revoked_at" IS NULL
        AND m."deleted_at" IS NULL
        AND e."customer_id" = app_current_customer_id()
        AND e."status" IN ('APPROVED', 'COMPLETED', 'ARCHIVED')
        AND e."deleted_at" IS NULL
    )
  );
