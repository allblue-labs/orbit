-- PR-37 — one access model: structural owner, organization RBAC and unit scope.

ALTER TABLE "organization_memberships"
  ADD COLUMN "uses_custom_access" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "custom_permissions" VARCHAR(160)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(160)[],
  ADD COLUMN "custom_allowed_surfaces" VARCHAR(10)[] NOT NULL DEFAULT ARRAY[]::VARCHAR(10)[];

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_custom_surfaces_valid" CHECK (
    NOT "uses_custom_access"
    OR (
      cardinality("custom_allowed_surfaces") > 0
      AND "custom_allowed_surfaces" <@ ARRAY['WEB','MOBILE','API']::VARCHAR(10)[]
    )
  );

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "organization_memberships_custom_permissions_no_wildcard"
  CHECK (NOT ('*' = ANY("custom_permissions")));

-- Ownership is an Organization invariant. The OWNER role remains a display
-- preset for legacy memberships, but no longer stores the authority wildcard.
UPDATE "roles" AS role
   SET "permissions" = ARRAY[]::VARCHAR(160)[],
       "allowed_surfaces" = ARRAY['WEB','MOBILE']::VARCHAR(10)[],
       "is_system" = true,
       "updated_at" = now()
 WHERE role."key" = 'OWNER'
   AND role."organization_id" IS NOT NULL;

-- Existing tenants receive the same server-owned presets as new tenants.
-- The catalogue is explicit so a deployment never derives authority from
-- whatever ad-hoc roles happen to exist in one organization.
WITH presets("key", "name", "description", "permissions", "surfaces") AS (
  VALUES
  (
    'ADMINISTRATOR', 'Administrador',
    'Administra a operação, pessoas e configurações sem assumir a propriedade da organização.',
    ARRAY[
      'ai.agents.create','ai.agents.delete','ai.agents.read','ai.agents.update',
      'ai.executions.cancel','ai.executions.create','ai.executions.read','analytics.read',
      'artifact_executions.create','artifact_executions.execute','artifact_executions.read','artifact_executions.update',
      'artifact_manifests.issue','artifact_manifests.read','artifact_manifests.revoke','artifact_rendering.render',
      'artifact_templates.create','artifact_templates.delete','artifact_templates.read','artifact_templates.update',
      'assets.create','assets.delete','assets.qr.manage','assets.read','assets.update',
      'automations.manage','automations.read','business_units.create','business_units.delete','business_units.update',
      'catalog.categories.create','catalog.categories.delete','catalog.categories.update','catalog.products.create',
      'catalog.products.delete','catalog.products.update','catalog.read','checklists.create','checklists.delete',
      'checklists.execute','checklists.read','checklists.update','contacts.create','contacts.delete','contacts.read',
      'contacts.update','customer_service_requests.manage','customer_service_requests.read','customers.create',
      'customers.delete','customers.read','customers.update','dashboard.read','financial.manage','financial.read',
      'identity.invitations.create','integrations.create','integrations.delete','integrations.read','integrations.update',
      'integrations.validate','inventory.manage','inventory.read','notifications.create','notifications.dispatch',
      'notifications.read','operations.assign','operations.attachments.create','operations.attachments.delete',
      'operations.attachments.read','operations.create','operations.delete','operations.history.read','operations.read',
      'operations.status.update','operations.update','organization.members.update','organization.read',
      'organization.roles.manage','organization.update','pmoc.manage','pmoc.read','quotes.manage','quotes.read',
      'report_templates.create','report_templates.delete','report_templates.read','report_templates.update',
      'reports.create','reports.delete','reports.documents.read','reports.finalize','reports.management.manage',
      'reports.management.read','reports.read','reports.render','reports.status.update','reports.update',
      'rvt.document','rvt.execute','rvt.manage','rvt.read','scheduling.allocations.manage',
      'scheduling.availability.manage','scheduling.calendars.create','scheduling.calendars.delete',
      'scheduling.calendars.update','scheduling.events.create','scheduling.events.delete','scheduling.events.update',
      'scheduling.intelligence.read','scheduling.read','signatures.create','signatures.read','signatures.revoke',
      'subscription.manage','usage.manage','usage.read'
    ]::varchar(160)[], ARRAY['WEB','MOBILE']::varchar(10)[]
  ),
  (
    'FIELD_TECHNICIAN', 'Técnico operador',
    'Executa atendimentos em campo, registra evidências, materiais e documentos relacionados.',
    ARRAY[
      'operations.read','operations.attachments.read','operations.history.read','customers.read','contacts.read',
      'assets.read','checklists.read','scheduling.read','inventory.read','catalog.read','pmoc.read','rvt.read',
      'reports.read','reports.documents.read','artifact_executions.read','artifact_manifests.read','notifications.read',
      'signatures.read','signatures.create','operations.update','operations.status.update',
      'operations.attachments.create','checklists.execute','checklists.update','inventory.manage','rvt.execute',
      'rvt.document','artifact_executions.create','artifact_executions.execute','artifact_executions.update',
      'artifact_manifests.issue','artifact_rendering.render','reports.create','reports.update',
      'reports.status.update','reports.finalize','reports.render'
    ]::varchar(160)[], ARRAY['MOBILE']::varchar(10)[]
  ),
  (
    'ASSISTANT_TECHNICIAN', 'Auxiliar técnico',
    'Acompanha atendimentos atribuídos e participa das execuções permitidas.',
    ARRAY[
      'operations.read','operations.attachments.read','operations.history.read','customers.read','contacts.read',
      'assets.read','checklists.read','scheduling.read','inventory.read','catalog.read','pmoc.read','rvt.read',
      'reports.read','reports.documents.read','artifact_executions.read','artifact_manifests.read','notifications.read',
      'signatures.read','signatures.create'
    ]::varchar(160)[], ARRAY['MOBILE']::varchar(10)[]
  ),
  (
    'TECHNICAL_RESPONSIBLE', 'Responsável técnico',
    'Revisa PMOC, RVT, assinaturas e documentação técnica sem administrar usuários.',
    ARRAY[
      'operations.read','operations.attachments.read','operations.history.read','customers.read','contacts.read',
      'assets.read','checklists.read','scheduling.read','inventory.read','catalog.read','pmoc.read','pmoc.manage',
      'rvt.read','rvt.manage','rvt.execute','rvt.document','reports.read','reports.create','reports.update',
      'reports.delete','reports.status.update','reports.finalize','reports.render','reports.documents.read',
      'artifact_executions.read','artifact_executions.create','artifact_executions.execute','artifact_executions.update',
      'artifact_manifests.read','artifact_manifests.issue','artifact_manifests.revoke','artifact_rendering.render',
      'artifact_templates.read','artifact_templates.create','artifact_templates.update','artifact_templates.delete',
      'report_templates.read','report_templates.create','report_templates.update','report_templates.delete',
      'signatures.read','signatures.create','signatures.revoke','notifications.read'
    ]::varchar(160)[], ARRAY['WEB','MOBILE']::varchar(10)[]
  ),
  (
    'CUSTOMER_SERVICE', 'Atendimento',
    'Atende clientes, organiza agenda e acompanha ordens de serviço.',
    ARRAY[
      'customers.read','customers.create','customers.update','customers.delete','contacts.read','contacts.create',
      'contacts.update','contacts.delete','assets.read','operations.read','operations.create','operations.update',
      'operations.assign','scheduling.read','scheduling.events.create','scheduling.events.update','quotes.read'
    ]::varchar(160)[], ARRAY['WEB']::varchar(10)[]
  ),
  (
    'FINANCIAL', 'Financeiro',
    'Gerencia financeiro, propostas e os documentos comerciais relacionados.',
    ARRAY['quotes.read','quotes.manage','inventory.read','inventory.manage','financial.read','financial.manage',
          'customers.read','reports.read','reports.documents.read','dashboard.read']::varchar(160)[],
    ARRAY['WEB']::varchar(10)[]
  ),
  (
    'VIEWER', 'Visualização',
    'Consulta informações operacionais sem alterar dados.',
    ARRAY[
      'operations.read','operations.attachments.read','operations.history.read','customers.read','contacts.read',
      'assets.read','checklists.read','scheduling.read','inventory.read','catalog.read','pmoc.read','rvt.read',
      'reports.read','reports.documents.read','artifact_executions.read','artifact_manifests.read','notifications.read',
      'signatures.read','dashboard.read','analytics.read','quotes.read','financial.read'
    ]::varchar(160)[], ARRAY['WEB']::varchar(10)[]
  )
)
INSERT INTO "roles" (
  "id", "organization_id", "key", "name", "description", "permissions",
  "allowed_surfaces", "is_system", "created_at", "updated_at"
)
SELECT
  (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  organization."id", preset."key", preset."name", preset."description",
  preset."permissions", preset."surfaces", true, now(), now()
FROM "organizations" AS organization
CROSS JOIN presets AS preset
WHERE organization."deleted_at" IS NULL
ON CONFLICT ("organization_id", "key") DO NOTHING;

-- The two original presets predate is_system and surface isolation. Make
-- their intended field-only boundary deterministic for existing tenants.
UPDATE "roles"
   SET "name" = 'Técnico operador',
       "allowed_surfaces" = ARRAY['MOBILE']::varchar(10)[],
       "is_system" = true,
       "updated_at" = now()
 WHERE "organization_id" IS NOT NULL
   AND "key" = 'FIELD_TECHNICIAN';

UPDATE "roles"
   SET "name" = 'Auxiliar técnico',
       "allowed_surfaces" = ARRAY['MOBILE']::varchar(10)[],
       "is_system" = true,
       "updated_at" = now()
 WHERE "organization_id" IS NOT NULL
   AND "key" = 'ASSISTANT_TECHNICIAN';

-- Legacy non-owner members without an explicit unit receive the primary unit.
-- Owner scope remains structural and therefore needs no materialized rows.
INSERT INTO "business_unit_memberships" (
  "id", "organization_id", "business_unit_id", "user_id", "role_id",
  "status", "joined_at"
)
SELECT
  (
    lpad(to_hex(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint), 12, '0') ||
    '7' || substr(replace(gen_random_uuid()::text, '-', ''), 14, 3) ||
    substr(replace(gen_random_uuid()::text, '-', ''), 17, 16)
  )::uuid,
  membership."organization_id", unit."id", membership."user_id",
  membership."role_id", 'ACTIVE', now()
FROM "organization_memberships" AS membership
JOIN "organizations" AS organization
  ON organization."id" = membership."organization_id"
JOIN "business_units" AS unit
  ON unit."organization_id" = membership."organization_id"
 AND unit."is_primary" = true
 AND unit."deleted_at" IS NULL
WHERE membership."deleted_at" IS NULL
  AND membership."status" = 'ACTIVE'
  AND membership."user_id" <> organization."owner_user_id"
  AND NOT EXISTS (
    SELECT 1
      FROM "business_unit_memberships" existing
     WHERE existing."organization_id" = membership."organization_id"
       AND existing."user_id" = membership."user_id"
       AND existing."deleted_at" IS NULL
  )
ON CONFLICT ("business_unit_id", "user_id") DO NOTHING;

-- Owner-aware bootstrap: after app.user_id and app.organization_id are set,
-- the owner may resolve every current unit. Those ids are then installed in
-- app.business_unit_ids and the existing tenant+unit policies remain final.
CREATE OR REPLACE FUNCTION app_is_organization_owner()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM organizations
     WHERE id = app_current_organization_id()
       AND owner_user_id = app_current_user_id()
       AND deleted_at IS NULL
  )
$$;

DROP POLICY IF EXISTS business_units_read ON business_units;
CREATE POLICY business_units_read ON business_units
  FOR SELECT
  USING (
    app_is_platform_admin()
    OR (
      organization_id = app_current_organization_id()
      AND (
        app_is_organization_owner()
        OR id = ANY(app_current_business_unit_ids())
      )
    )
  );
